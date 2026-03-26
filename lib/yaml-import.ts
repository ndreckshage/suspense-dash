/**
 * YAML-to-DashboardData transformer.
 *
 * Parses a human-friendly YAML file with top-level query definitions,
 * subgraph latency profiles, and a boundary tree that references queries
 * by name. Produces pre-computed data for each dashboard tab keyed by
 * percentile.
 *
 * Key design: boundary-level fetch for the waterfall is "fudged" from query
 * data — the highest-variance query gets the experience percentile while
 * others stay near p50. Tree and subgraph views use declared percentile
 * values directly.
 */

import { parse as parseYaml } from "yaml";
import type { NavigationTiming } from "./client-metrics-store";
import { buildSubgraphColorMap, DEFAULT_SUBGRAPH_COLOR } from "./subgraph-colors";
import type {
  DashboardData,
  DashboardWaterfallData,
  DashboardTreeData,
  DashboardTreeNode,
  DashboardSubgraphData,
  DashboardSubgraphRow,
  DashboardOperationDetail,
  WaterfallTiming,
  WaterfallCsrTiming,
  DashboardLoAFEntry,
} from "./dashboard-types";

// ---- YAML schema types ----

/** Percentile map or scalar (scalar = same at all percentiles) */
type PctlValue = number | Record<string, number>;

/** Top-level query definition */
interface YamlQueryDef {
  slo?: number;
  latency: PctlValue;
  ops: Record<string, number>;  // subgraph-name → weight (0–1)
}

/** Boundary query reference (array item) */
type YamlBoundaryQueryRef = string | { name: string; memoized?: boolean; prefetch?: boolean };

interface YamlBoundary {
  render_cost?: PctlValue;
  lcp_critical?: boolean;
  csr?: boolean;
  queries?: YamlBoundaryQueryRef[];
  [key: string]: unknown;
}

interface YamlNavTiming {
  dom_interactive: PctlValue;
  dom_content_loaded: PctlValue;
  load_event: PctlValue;
  tbt: PctlValue;
}

interface YamlLoAFScript {
  fn?: string;
  file?: string;
  duration: number;
}

interface YamlLoAFEntry {
  start: number;
  duration: number;
  blocking: number;
  scripts?: YamlLoAFScript[];
}

interface YamlSubgraph {
  slo?: number;
  latency?: PctlValue;
}

interface YamlPage {
  route: string;
  queries?: Record<string, YamlQueryDef>;
  subgraphs?: Record<string, YamlSubgraph>;
  hydration_ms?: PctlValue;
  initialization_ms?: PctlValue;
  navigation_timing?: YamlNavTiming;
  loaf_entries?: YamlLoAFEntry[];
  /** Edge/network overhead before the server starts processing (ms). Default: 20 */
  network_offset_ms?: PctlValue;
  /** Browser image download + decode + paint latency after LCP HTML streams (ms). Default: 80 */
  lcp_image_latency_ms?: PctlValue;
  boundaries: Record<string, YamlBoundary>;
  csr_boundaries?: Record<string, YamlBoundary>;
}

// Reserved keys that are boundary properties, not child boundary names
const RESERVED_KEYS = new Set([
  "render_cost",
  "lcp_critical",
  "csr",
  "queries",
]);

// Standard percentiles the dashboard supports
const PCTLS = [50, 75, 90, 95, 99];

// ---- Helpers ----

/** Resolve a PctlValue at a given percentile. Scalars return as-is. */
function atPctl(value: PctlValue | undefined, pctl: number, fallback = 0): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  // Look for exact match first, then nearest lower
  const key = `p${pctl}`;
  if (key in value) return value[key];
  // Fall back to p50, then first available
  if ("p50" in value) return value["p50"];
  const keys = Object.keys(value);
  return keys.length > 0 ? value[keys[0]] : fallback;
}

function getChildBoundaries(node: YamlBoundary): Record<string, YamlBoundary> {
  const children: Record<string, YamlBoundary> = {};
  for (const [key, value] of Object.entries(node)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // Must look like a boundary (not a percentile map which has p50/p90/etc keys)
      const keys = Object.keys(value);
      const looksLikePctlMap = keys.every((k) => k.startsWith("p") && !isNaN(Number(k.slice(1))));
      if (!looksLikePctlMap) {
        children[key] = value as YamlBoundary;
      }
    }
  }
  return children;
}

// ---- Collect all boundary/query/op info from the tree ----

interface BoundaryInfo {
  name: string;
  path: string;
  parentPath: string;
  lcpCritical: boolean;
  renderCost: PctlValue;
  queries: QueryInfo[];
  children: BoundaryInfo[];
  phase: "ssr" | "csr";
}

interface QueryInfo {
  queryName: string;
  boundaryPath: string;
  slo: number;
  latency: PctlValue;
  memoized: boolean;
  prefetch: boolean;
  ops: OpInfo[];
  phase: "ssr" | "csr";
}

interface OpInfo {
  rawName: string;
  opName: string;
  subgraphName: string;
  weight: number;
  boundaryPath: string;
  queryName: string;
  phase: "ssr" | "csr";
}

function collectBoundaryTree(
  name: string,
  node: YamlBoundary,
  parentPath: string,
  phase: "ssr" | "csr",
  queryDefs: Record<string, YamlQueryDef>,
): BoundaryInfo {
  // Allow individual boundaries to override phase via `csr: true`
  const effectivePhase = node.csr ? "csr" : phase;
  const path = parentPath ? `${parentPath}.${name}` : name;

  const queries: QueryInfo[] = [];
  if (node.queries && Array.isArray(node.queries)) {
    for (const ref of node.queries) {
      const queryName = typeof ref === "string" ? ref : ref.name;
      const memoized = typeof ref === "object" ? (ref.memoized ?? false) : false;
      const prefetch = typeof ref === "object" ? (ref.prefetch ?? false) : false;

      const def = queryDefs[queryName];
      const slo = def?.slo ?? 0;
      const latency = def?.latency ?? 0;

      const ops: OpInfo[] = [];
      if (def?.ops) {
        for (const [rawName, weight] of Object.entries(def.ops)) {
          ops.push({
            rawName,
            opName: rawName,
            subgraphName: rawName,
            weight,
            boundaryPath: path,
            queryName,
            phase: effectivePhase,
          });
        }
      }

      queries.push({
        queryName,
        boundaryPath: path,
        slo,
        latency,
        memoized,
        prefetch,
        ops,
        phase: effectivePhase,
      });
    }
  }

  const childBoundaries = getChildBoundaries(node);
  const children: BoundaryInfo[] = [];
  for (const [childName, childNode] of Object.entries(childBoundaries)) {
    children.push(collectBoundaryTree(childName, childNode, path, effectivePhase, queryDefs));
  }

  return {
    name,
    path,
    parentPath,
    lcpCritical: node.lcp_critical ?? false,
    renderCost: node.render_cost ?? 1,
    queries,
    children,
    phase: effectivePhase,
  };
}

/** Flatten the tree into a list (pre-order) */
function flattenTree(nodes: BoundaryInfo[]): BoundaryInfo[] {
  const result: BoundaryInfo[] = [];
  function walk(node: BoundaryInfo) {
    result.push(node);
    for (const child of node.children) walk(child);
  }
  for (const n of nodes) walk(n);
  return result;
}

// ---- Waterfall computation ----

/**
 * Compute the waterfall for a given experience percentile.
 *
 * "Fudging" algorithm: for a p90 experience, the highest-variance query
 * drives the page time. That query uses its p90 duration for the boundary
 * fetch. Other boundaries use their query's p50 duration. This produces
 * a coherent scenario where ONE thing is slow, not everything.
 */
function computeWaterfall(
  ssrBoundaries: BoundaryInfo[],
  csrBoundaries: BoundaryInfo[],
  pctl: number,
  hydrationMs: number,
  initializationMs: number,
  navTiming: NavigationTiming | null,
  loafEntries: DashboardLoAFEntry[],
  colorMap: Map<string, string>,
  networkOffsetMs: number,
  lcpImageLatencyMs: number,
): DashboardWaterfallData {
  const flat = flattenTree(ssrBoundaries);

  // Compute each boundary's query duration at p50 and at the target pctl
  const boundaryDurations: {
    boundary: BoundaryInfo;
    queryDurationP50: number;
    queryDurationPctl: number;
    variance: number;
  }[] = [];

  for (const b of flat) {
    if (b.queries.length === 0) {
      boundaryDurations.push({ boundary: b, queryDurationP50: 0, queryDurationPctl: 0, variance: 0 });
      continue;
    }
    // Use the max duration across all awaited queries in this boundary
    // (prefetch queries start the fetch but don't suspend, so they don't
    // contribute to the boundary's fetch duration)
    let dP50 = 0;
    let dPctl = 0;
    for (const q of b.queries) {
      if (q.prefetch) continue;
      // Skip fully-memoized queries — they don't suspend the boundary.
      if (q.memoized) continue;
      const qP50 = atPctl(q.latency, 50);
      const qPctl = atPctl(q.latency, pctl);
      dP50 = Math.max(dP50, qP50);
      dPctl = Math.max(dPctl, qPctl);
    }
    boundaryDurations.push({
      boundary: b,
      queryDurationP50: dP50,
      queryDurationPctl: dPctl,
      variance: dPctl - dP50,
    });
  }

  // Sort by variance to find the bottleneck
  const sorted = [...boundaryDurations].sort((a, b) => b.variance - a.variance);
  const bottleneckPath = sorted.length > 0 && sorted[0].variance > 0
    ? sorted[0].boundary.path
    : null;

  // Assign fetch durations: bottleneck gets pctl, others get p50
  // Allow second-highest-variance to get a mild bump too
  const fetchByPath = new Map<string, number>();
  for (const entry of boundaryDurations) {
    if (entry.boundary.path === bottleneckPath) {
      fetchByPath.set(entry.boundary.path, entry.queryDurationPctl);
    } else if (sorted.length > 1 && entry.boundary.path === sorted[1]?.boundary.path && sorted[1].variance > 0) {
      // Second-highest variance gets a mild bump (interpolate toward pctl)
      const blend = 0.3;
      fetchByPath.set(entry.boundary.path, Math.round(
        entry.queryDurationP50 + (entry.queryDurationPctl - entry.queryDurationP50) * blend,
      ));
    } else {
      fetchByPath.set(entry.boundary.path, entry.queryDurationP50);
    }
  }

  // Run scheduling simulation to compute wall_start_ms
  interface ScheduledBoundary {
    info: BoundaryInfo;
    wallStart: number;
    fetchDuration: number;
    renderCost: number;
  }
  const scheduled: ScheduledBoundary[] = [];

  // Track in-flight prefetches: queryName → { wallStart when kicked off, fetch duration }
  // Used to compute remaining time for memoized descendants.
  const prefetchRegistry = new Map<string, { wallStart: number; duration: number }>();
  // Track first awaited execution of each query for memoization remaining time
  const queryExecRegistry = new Map<string, { wallStart: number; duration: number }>();

  function schedule(
    nodes: BoundaryInfo[],
    parentFetchEnd: number,
    threadAvailable: number,
  ): number {
    let thread = threadAvailable;
    for (const b of nodes) {
      const fetchStart = parentFetchEnd;

      // Register any prefetch queries kicked off by this boundary
      for (const q of b.queries) {
        if (!q.prefetch) continue;
        const prefetchDuration = atPctl(q.latency, pctl);
        prefetchRegistry.set(q.queryName, { wallStart: fetchStart, duration: prefetchDuration });
      }

      // Register awaited, non-memoized query executions for memoization tracking
      for (const q of b.queries) {
        if (q.prefetch) continue;
        if (q.memoized) continue;
        if (!queryExecRegistry.has(q.queryName)) {
          const qDuration = atPctl(q.latency, pctl);
          queryExecRegistry.set(q.queryName, { wallStart: fetchStart, duration: qDuration });
        }
      }

      // Compute effective fetch duration, accounting for memoized queries
      // that may have a prefetch or prior execution in-flight
      let fetchDuration = fetchByPath.get(b.path) ?? 0;
      // If the boundary's own awaited-query duration is 0 (e.g. all queries are
      // memoized), check if any memoized query has remaining time from prefetch or prior exec
      if (fetchDuration === 0) {
        for (const q of b.queries) {
          if (q.prefetch) continue;
          if (q.memoized) {
            const source = prefetchRegistry.get(q.queryName) ?? queryExecRegistry.get(q.queryName);
            if (source) {
              const remaining = Math.max(0, (source.wallStart + source.duration) - fetchStart);
              fetchDuration = Math.max(fetchDuration, remaining);
            }
          }
        }
      }

      const renderCost = atPctl(b.renderCost, pctl, 1);
      const fetchEnd = fetchStart + fetchDuration;

      scheduled.push({
        info: b,
        wallStart: fetchStart,
        fetchDuration,
        renderCost,
      });

      // Children fetch concurrently after parent fetch, render serially
      thread = schedule(b.children, fetchEnd, thread);
    }
    return thread;
  }

  schedule(ssrBoundaries, networkOffsetMs, 0);

  // Build BoundaryTiming[] with thread simulation
  const ssrTimings: WaterfallTiming[] = scheduled.map((s) => {
    const queryNames = s.info.queries.filter((q) => !q.prefetch).map((q) => q.queryName).filter(Boolean);
    const queryName = queryNames[0] ?? "";
    const prefetchQueryNames = s.info.queries.filter((q) => q.prefetch).map((q) => q.queryName).filter(Boolean);

    // A boundary is "fully memoized" only if all its queries are memoized AND
    // there is no remaining wait time (fetchDuration === 0)
    const allMemoized = s.info.queries.length > 0 &&
      s.info.queries.every((q) => q.prefetch || q.memoized);
    const isMemoized = allMemoized && s.fetchDuration === 0;

    // Determine color from the heaviest subgraph (highest weight)
    let subgraphColor: string | undefined;
    let maxWeight = 0;
    for (const q of s.info.queries) {
      for (const op of q.ops) {
        if (op.weight > maxWeight) {
          maxWeight = op.weight;
          subgraphColor = colorMap.get(op.subgraphName);
        }
      }
    }

    return {
      name: s.info.name,
      boundaryPath: s.info.path,
      wallStart: Math.round(s.wallStart),
      fetchDuration: isMemoized ? 0 : Math.round(s.fetchDuration),
      renderCost: Math.round(s.renderCost),
      blocked: 0,
      total: Math.round(s.fetchDuration + s.renderCost),
      lcpCritical: s.info.lcpCritical,
      queryName,
      queryNames,
      memoized: isMemoized,
      subgraphColor,
      prefetchQueries: prefetchQueryNames.length > 0 ? prefetchQueryNames : undefined,
    };
  });

  // CSR timings
  const csrTimings: WaterfallCsrTiming[] = [];
  if (csrBoundaries.length > 0) {
    const csrFlat = flattenTree(csrBoundaries);
    let csrWallStart = hydrationMs;
    for (const b of csrFlat) {
      let fetchDuration = 0;
      for (const q of b.queries) {
        if (q.prefetch) continue;
        const qDuration = atPctl(q.latency, 50); // CSR uses ~p50 in waterfall
        fetchDuration = Math.max(fetchDuration, qDuration);
      }
      const csrQueryNames = b.queries.map((q) => q.queryName).filter(Boolean);
      csrTimings.push({
        name: b.name,
        boundaryPath: b.path,
        wallStart: Math.round(csrWallStart),
        fetchDuration: Math.round(fetchDuration),
        queryName: csrQueryNames[0] ?? "",
        queryNames: csrQueryNames,
      });
      csrWallStart += fetchDuration + atPctl(b.renderCost, pctl, 1);
    }
  }

  return { ssrTimings, csrTimings, hydrationMs, initializationMs, navigationTiming: navTiming, loafEntries, networkOffsetMs, lcpImageLatencyMs };
}

// ---- Tree computation ----

function computeTree(
  ssrRoots: BoundaryInfo[],
  csrRoots: BoundaryInfo[],
  pctl: number,
  colorMap: Map<string, string>,
  sloMap: Map<string, number>,
  subgraphLatencyMap: Map<string, PctlValue>,
): DashboardTreeData {
  const allBoundaries = [...flattenTree(ssrRoots), ...flattenTree(csrRoots)];
  const allPaths = new Set(allBoundaries.map((b) => b.path));

  // Compute depths
  function getDepth(path: string): number {
    let depth = 0;
    let candidate = path;
    while (true) {
      const dotIdx = candidate.lastIndexOf(".");
      if (dotIdx === -1) break;
      candidate = candidate.substring(0, dotIdx);
      if (allPaths.has(candidate)) depth++;
    }
    return depth;
  }

  // Schedule boundaries to compute wallStart (same algorithm as waterfall but
  // using real pctl fetch durations, not the fudged waterfall values)
  const wallStartByPath = new Map<string, number>();
  const treePrefetchRegistry = new Map<string, { wallStart: number; duration: number }>();
  // Track first awaited execution of each query for memoization remaining time
  const treeQueryExecRegistry = new Map<string, { wallStart: number; duration: number }>();

  function scheduleBoundaries(roots: BoundaryInfo[], parentFetchEnd: number) {
    for (const b of roots) {
      const fetchStart = parentFetchEnd;

      // Register prefetch queries
      for (const q of b.queries) {
        if (!q.prefetch) continue;
        const prefetchDuration = atPctl(q.latency, pctl);
        treePrefetchRegistry.set(q.queryName, { wallStart: fetchStart, duration: prefetchDuration });
      }

      // Register awaited, non-memoized query executions for memoization tracking
      for (const q of b.queries) {
        if (q.prefetch) continue;
        if (q.memoized) continue;
        if (!treeQueryExecRegistry.has(q.queryName)) {
          const qDuration = atPctl(q.latency, pctl);
          treeQueryExecRegistry.set(q.queryName, { wallStart: fetchStart, duration: qDuration });
        }
      }

      // Compute awaited fetch duration (skip prefetch queries)
      let boundaryFetch = 0;
      for (const q of b.queries) {
        if (q.prefetch) continue;
        if (q.memoized) {
          // Check for in-flight prefetch or prior execution remaining time
          const source = treePrefetchRegistry.get(q.queryName) ?? treeQueryExecRegistry.get(q.queryName);
          if (source) {
            const remaining = Math.max(0, (source.wallStart + source.duration) - fetchStart);
            boundaryFetch = Math.max(boundaryFetch, remaining);
          }
          continue;
        }
        const qDuration = atPctl(q.latency, pctl);
        boundaryFetch = Math.max(boundaryFetch, qDuration);
      }
      wallStartByPath.set(b.path, fetchStart);
      // Children fetch concurrently after parent fetch completes
      scheduleBoundaries(b.children, fetchStart + boundaryFetch);
    }
  }
  scheduleBoundaries(ssrRoots, 0);
  // CSR boundaries (if passed separately) start after hydration — but we don't
  // have hydrationMs here, so just use 0-based offsets
  if (csrRoots.length > 0) {
    scheduleBoundaries(csrRoots, 0);
  }

  const nodes: DashboardTreeNode[] = [];
  let uncachedOps = 0;
  let cachedOps = 0;

  for (const b of allBoundaries) {
    const depth = getDepth(b.path);
    const hasChildren = b.children.length > 0 || b.queries.length > 0;

    // Query-level fetch for the boundary row — use max across awaited queries
    const wallStart = wallStartByPath.get(b.path) ?? 0;
    let boundaryFetch = 0;
    for (const q of b.queries) {
      if (q.prefetch) continue;
      if (q.memoized) {
        // Check for in-flight prefetch or prior execution remaining time
        const source = treePrefetchRegistry.get(q.queryName) ?? treeQueryExecRegistry.get(q.queryName);
        if (source) {
          const remaining = Math.max(0, (source.wallStart + source.duration) - wallStart);
          boundaryFetch = Math.max(boundaryFetch, remaining);
        }
        continue;
      }
      const qDuration = atPctl(q.latency, pctl);
      boundaryFetch = Math.max(boundaryFetch, qDuration);
    }

    const renderCost = atPctl(b.renderCost, pctl, 1);

    nodes.push({
      name: b.name,
      path: b.path,
      depth,
      type: "boundary",
      boundaryPath: b.path,
      queryLatencyPctl: boundaryFetch,
      subgraphLatencyPctl: 0,
      querySlo: 0,
      subgraphSlo: 0,
      weight: 0,
      lcpCritical: b.lcpCritical,
      memoized: false,
      prefetch: false,
      hasChildren,
      phase: b.phase,
      wallStartPctl: Math.round(wallStart),
      renderCostPctl: renderCost,
    });

    // Query nodes
    for (let qi = 0; qi < b.queries.length; qi++) {
      const q = b.queries[qi];
      const queryLatency = atPctl(q.latency, pctl);

      // Query/op rows always show raw actual duration (the UI fades memoized rows).
      // The boundary row already computes its own remaining-time logic separately.

      nodes.push({
        name: q.queryName,
        path: `${b.path}.query${qi > 0 ? qi : ""}`,
        depth: depth + 1,
        type: "query",
        boundaryPath: b.path,
        queryLatencyPctl: queryLatency,
        subgraphLatencyPctl: 0,
        querySlo: q.slo,
        subgraphSlo: 0,
        weight: 0,
        lcpCritical: false,
        memoized: q.memoized,
        prefetch: q.prefetch,
        hasChildren: false,
        phase: b.phase,
        wallStartPctl: 0,
        renderCostPctl: 0,
      });

      // Build subgraph-op nodes
      let oi = 0;
      for (const op of q.ops) {
        if (op.weight > 0) {
          // Count for summary
          if (q.memoized) cachedOps++; else uncachedOps++;
        }

        const sgSlo = sloMap.get(op.subgraphName) ?? 0;
        const subgraphColor = colorMap.get(op.subgraphName) ?? DEFAULT_SUBGRAPH_COLOR;
        const sgLatency = subgraphLatencyMap.get(op.subgraphName);
        const subgraphLatencyAtPctl = sgLatency ? atPctl(sgLatency, pctl) : 0;

        nodes.push({
          name: op.subgraphName,
          path: `${b.path}.query${qi > 0 ? qi : ""}.op${oi > 0 ? oi : ""}`,
          depth: depth + 2,
          type: "subgraph-op",
          boundaryPath: b.path,
          queryLatencyPctl: op.weight * queryLatency,
          subgraphLatencyPctl: subgraphLatencyAtPctl,
          querySlo: 0,
          subgraphSlo: sgSlo,
          weight: op.weight,
          lcpCritical: false,
          memoized: q.memoized,
          prefetch: q.prefetch,
          hasChildren: false,
          phase: b.phase,
          wallStartPctl: 0,
          renderCostPctl: 0,
          subgraphName: op.subgraphName,
          subgraphColor,
        });
        oi++;
      }
    }
  }

  // Thread simulation for boundary blocked_ms
  const boundaryNodes = nodes.filter((n) => n.type === "boundary" && n.renderCostPctl > 0);
  const sortedByFetchEnd = [...boundaryNodes].sort(
    (a, b) => (a.wallStartPctl + a.queryLatencyPctl) - (b.wallStartPctl + b.queryLatencyPctl),
  );
  let threadCursor = 0;
  for (const bn of sortedByFetchEnd) {
    const fetchEnd = bn.wallStartPctl + bn.queryLatencyPctl;
    const renderStart = Math.max(threadCursor, fetchEnd);
    threadCursor = renderStart + bn.renderCostPctl;
  }

  const totalOps = uncachedOps + cachedOps;
  const callSummary = totalOps > 0
    ? { callsPerReq: uncachedOps, dedupedPerReq: cachedOps }
    : null;

  return { nodes, callSummary };
}

// ---- Subgraph computation ----

function computeSubgraphs(
  ssrRoots: BoundaryInfo[],
  csrRoots: BoundaryInfo[],
  pctl: number,
  colorMap: Map<string, string>,
  sloMap: Map<string, number>,
  subgraphLatencyMap: Map<string, PctlValue>,
): DashboardSubgraphData {
  const allBoundaries = [...flattenTree(ssrRoots), ...flattenTree(csrRoots)];

  let ssrUncached = 0;
  let csrUncached = 0;
  let totalCached = 0;

  // Collect all ops — keyed by (opName, queryName, boundaryPath, phase) to
  // correctly track isClient per call site rather than collapsing across phases
  const opsBySubgraph = new Map<string, {
    ops: Map<string, {
      opName: string;
      weight: number;
      queryLatencyPctl: number;
      durations: number[];
      boundaries: Set<string>;
      queryNames: Set<string>;
      isClient: boolean;
      cached: boolean;
    }>;
  }>();

  for (const b of allBoundaries) {
    for (const q of b.queries) {
      const queryLatency = atPctl(q.latency, pctl);

      for (const op of q.ops) {
        const duration = op.weight * queryLatency;

        if (q.memoized) totalCached++;
        else if (op.phase === "csr") csrUncached++;
        else ssrUncached++;

        let sg = opsBySubgraph.get(op.subgraphName);
        if (!sg) {
          sg = { ops: new Map() };
          opsBySubgraph.set(op.subgraphName, sg);
        }

        // Key by opName + queryName + boundaryPath + phase to avoid collapsing
        // SSR and CSR calls to the same subgraph into one entry
        const opKey = `${op.opName}:${op.queryName}:${op.boundaryPath}:${op.phase}`;
        let opData = sg.ops.get(opKey);
        if (!opData) {
          opData = {
            opName: op.opName,
            weight: op.weight,
            queryLatencyPctl: queryLatency,
            durations: [],
            boundaries: new Set(),
            queryNames: new Set(),
            isClient: op.phase === "csr",
            cached: q.memoized,
          };
          sg.ops.set(opKey, opData);
        }

        if (!q.memoized) opData.durations.push(duration);
        opData.boundaries.add(op.boundaryPath);
        opData.queryNames.add(op.queryName);
      }
    }
  }

  const rows: DashboardSubgraphRow[] = [];
  for (const [sgName, sg] of opsBySubgraph) {
    const color = colorMap.get(sgName) ?? DEFAULT_SUBGRAPH_COLOR;
    const operations: DashboardOperationDetail[] = [];

    let sgUncachedCount = 0;

    // Get real subgraph latency from the subgraphs section
    const sgLatency = subgraphLatencyMap.get(sgName);
    const sgLatencyAtPctl = sgLatency ? atPctl(sgLatency, pctl) : 0;

    for (const [, opData] of sg.ops) {
      const uncachedCount = opData.durations.length;
      sgUncachedCount += uncachedCount;
      const durationPctl = opData.weight * opData.queryLatencyPctl;

      operations.push({
        name: opData.opName,
        callsPerReq: uncachedCount,
        weight: opData.weight,
        queryLatencyPctl: opData.queryLatencyPctl,
        durationPctl,
        boundaries: [...opData.boundaries],
        queryNames: [...opData.queryNames],
        isClient: opData.isClient,
      });
    }

    operations.sort((a, b) => b.callsPerReq - a.callsPerReq);

    rows.push({
      name: sgName,
      color,
      sloMs: sloMap.get(sgName) ?? 0,
      callsPerReq: sgUncachedCount,
      subgraphLatencyPctl: sgLatencyAtPctl,
      operations,
    });
  }

  rows.sort((a, b) => b.callsPerReq - a.callsPerReq);

  return {
    summary: {
      ssrCallsPerReq: ssrUncached,
      csrCallsPerReq: csrUncached,
      dedupedPerReq: totalCached,
    },
    rows,
  };
}

// ---- Main entry point ----

export function parseYamlDashboard(yamlString: string): DashboardData {
  const doc = parseYaml(yamlString) as YamlPage;

  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid YAML: expected a document object");
  }
  if (!doc.route) {
    throw new Error("YAML must have a 'route' field");
  }
  if (!doc.boundaries || typeof doc.boundaries !== "object") {
    throw new Error("YAML must have a 'boundaries' section");
  }

  const queryDefs = doc.queries ?? {};

  // Collect full tree structure (CSR boundaries are nested inline with csr: true)
  const allRoots: BoundaryInfo[] = [];
  for (const [name, node] of Object.entries(doc.boundaries)) {
    allRoots.push(collectBoundaryTree(name, node, "", "ssr", queryDefs));
  }

  // Legacy support: standalone csr_boundaries section
  if (doc.csr_boundaries) {
    for (const [name, node] of Object.entries(doc.csr_boundaries)) {
      allRoots.push(collectBoundaryTree(name, node, "csr", "csr", queryDefs));
    }
  }

  // Extract CSR boundaries from the tree for waterfall computation (which
  // treats SSR and CSR separately), while keeping them nested for tree view.
  function extractCsrBoundaries(roots: BoundaryInfo[]): { ssrRoots: BoundaryInfo[]; csrRoots: BoundaryInfo[] } {
    const csrRoots: BoundaryInfo[] = [];

    function processChildren(children: BoundaryInfo[]): BoundaryInfo[] {
      const ssrChildren: BoundaryInfo[] = [];
      for (const child of children) {
        if (child.phase === "csr") {
          csrRoots.push(child);
        } else {
          ssrChildren.push({ ...child, children: processChildren(child.children) });
        }
      }
      return ssrChildren;
    }

    const ssrRoots: BoundaryInfo[] = [];
    for (const root of roots) {
      if (root.phase === "csr") {
        csrRoots.push(root);
      } else {
        ssrRoots.push({ ...root, children: processChildren(root.children) });
      }
    }
    return { ssrRoots, csrRoots };
  }

  const { ssrRoots, csrRoots } = extractCsrBoundaries(allRoots);

  // Collect all unique subgraph names from the tree to build a dynamic color map
  function collectSubgraphNames(roots: BoundaryInfo[]): Set<string> {
    const names = new Set<string>();
    for (const b of flattenTree(roots)) {
      for (const q of b.queries) {
        for (const op of q.ops) {
          names.add(op.subgraphName);
        }
      }
    }
    return names;
  }
  const subgraphColorMap = buildSubgraphColorMap(collectSubgraphNames(allRoots));

  // Build subgraph SLO map from YAML subgraphs section
  const subgraphSloMap = new Map<string, number>();
  const subgraphLatencyMap = new Map<string, PctlValue>();
  if (doc.subgraphs) {
    for (const [name, cfg] of Object.entries(doc.subgraphs)) {
      subgraphSloMap.set(name, cfg?.slo ?? 0);
      if (cfg?.latency) {
        subgraphLatencyMap.set(name, cfg.latency);
      }
    }
  }

  // Compute pre-computed data for each percentile
  const waterfall: Record<number, DashboardWaterfallData> = {};
  const tree: Record<number, DashboardTreeData> = {};
  const subgraphs: Record<number, DashboardSubgraphData> = {};

  // Default offsets: 20ms edge/network overhead, 80ms browser image latency
  const DEFAULT_NETWORK_OFFSET = 20;
  const DEFAULT_LCP_IMAGE_LATENCY = 80;

  for (const pctl of PCTLS) {
    const hydrationMs = Math.round(atPctl(doc.hydration_ms, pctl));
    const initializationMs = doc.initialization_ms
      ? Math.round(atPctl(doc.initialization_ms, pctl))
      : 0;
    const networkOffsetMs = Math.round(
      atPctl(doc.network_offset_ms, pctl, DEFAULT_NETWORK_OFFSET),
    );
    const lcpImageLatencyMs = Math.round(
      atPctl(doc.lcp_image_latency_ms, pctl, DEFAULT_LCP_IMAGE_LATENCY),
    );


    let navTiming: NavigationTiming | null = null;
    if (doc.navigation_timing) {
      const nt = doc.navigation_timing;
      navTiming = {
        domInteractive: Math.round(atPctl(nt.dom_interactive, pctl)),
        domContentLoaded: Math.round(atPctl(nt.dom_content_loaded, pctl)),
        loadEvent: Math.round(atPctl(nt.load_event, pctl)),
        tbt: Math.round(atPctl(nt.tbt, pctl)),
        loafCount: 0,
      };
    }

    // Convert YAML LoAF entries to mock format (same entries at all percentiles)
    const loafEntries: DashboardLoAFEntry[] = (doc.loaf_entries ?? []).map((e) => ({
      startTime: e.start,
      duration: e.duration,
      blockingDuration: e.blocking,
      scripts: (e.scripts ?? []).map((s) => ({
        sourceURL: s.file ?? "",
        sourceFunctionName: s.fn ?? "",
        duration: s.duration,
      })),
    }));

    // Derive loafCount from entries
    if (navTiming) navTiming.loafCount = loafEntries.length;

    waterfall[pctl] = computeWaterfall(ssrRoots, csrRoots, pctl, hydrationMs, initializationMs, navTiming, loafEntries, subgraphColorMap, networkOffsetMs, lcpImageLatencyMs);
    // Tree uses the full (un-split) roots so CSR boundaries stay nested under parents
    tree[pctl] = computeTree(allRoots, [], pctl, subgraphColorMap, subgraphSloMap, subgraphLatencyMap);
    subgraphs[pctl] = computeSubgraphs(ssrRoots, csrRoots, pctl, subgraphColorMap, subgraphSloMap, subgraphLatencyMap);
  }

  return { route: doc.route, waterfall, tree, subgraphs };
}
