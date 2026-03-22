/**
 * YAML-to-MockDashboardData transformer.
 *
 * Parses a human-friendly YAML file with a unified boundary tree containing
 * inline percentile values for queries and operations. Produces pre-computed
 * data for each dashboard tab keyed by percentile.
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
  MockDashboardData,
  MockWaterfallData,
  MockTreeData,
  MockTreeNode,
  MockSubgraphData,
  MockSubgraphRow,
  MockOperationDetail,
  WaterfallTiming,
  WaterfallCsrTiming,
  MockLoAFEntry,
} from "./mock-metrics";

// ---- YAML schema types ----

/** Percentile map or scalar (scalar = same at all percentiles) */
type PctlValue = number | Record<string, number>;

interface YamlOp {
  duration: PctlValue;
  cached?: boolean;
}

interface YamlQuery {
  duration?: PctlValue;
  ops: Record<string, PctlValue | YamlOp>;
}

interface YamlBoundary {
  render_cost?: PctlValue;
  lcp_critical?: boolean;
  csr?: boolean;
  queries?: Record<string, YamlQuery>;
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
}

interface YamlPage {
  route: string;
  subgraphs?: Record<string, YamlSubgraph>;
  hydration_ms?: PctlValue;
  initialization_ms?: PctlValue;
  navigation_timing?: YamlNavTiming;
  loaf_entries?: YamlLoAFEntry[];
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

/** Op keys in the YAML are just subgraph names. */
function resolveSubgraph(rawName: string): string {
  return rawName;
}

function resolveOpName(rawName: string): string {
  return rawName;
}

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

/** Resolve an op value (can be a scalar, percentile map, or {duration, cached} object) */
function resolveOpDuration(opValue: PctlValue | YamlOp, pctl: number): { duration: number; cached: boolean } {
  if (typeof opValue === "number") {
    return { duration: opValue, cached: false };
  }
  if ("duration" in opValue) {
    return {
      duration: atPctl((opValue as YamlOp).duration, pctl),
      cached: (opValue as YamlOp).cached ?? false,
    };
  }
  // It's a percentile map
  return { duration: atPctl(opValue as Record<string, number>, pctl), cached: false };
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
  duration?: PctlValue;
  ops: OpInfo[];
  phase: "ssr" | "csr";
}

interface OpInfo {
  rawName: string;
  opName: string;
  subgraphName: string;
  value: PctlValue | YamlOp;
  boundaryPath: string;
  queryName: string;
  phase: "ssr" | "csr";
}

function collectBoundaryTree(
  name: string,
  node: YamlBoundary,
  parentPath: string,
  phase: "ssr" | "csr",
): BoundaryInfo {
  // Allow individual boundaries to override phase via `csr: true`
  const effectivePhase = node.csr ? "csr" : phase;
  const path = parentPath ? `${parentPath}.${name}` : name;

  const queries: QueryInfo[] = [];
  if (node.queries) {
    for (const [queryName, query] of Object.entries(node.queries)) {
      const ops: OpInfo[] = [];
      for (const [rawName, value] of Object.entries(query.ops)) {
        ops.push({
          rawName,
          opName: resolveOpName(rawName),
          subgraphName: resolveSubgraph(rawName),
          value,
          boundaryPath: path,
          queryName,
          phase: effectivePhase,
        });
      }
      queries.push({
        queryName,
        boundaryPath: path,
        duration: query.duration,
        ops,
        phase: effectivePhase,
      });
    }
  }

  const childBoundaries = getChildBoundaries(node);
  const children: BoundaryInfo[] = [];
  for (const [childName, childNode] of Object.entries(childBoundaries)) {
    children.push(collectBoundaryTree(childName, childNode, path, effectivePhase));
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
  loafEntries: MockLoAFEntry[],
  colorMap: Map<string, string>,
): MockWaterfallData {
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
    // Use the first (primary) query's duration
    const q = b.queries[0];
    let dP50: number;
    let dPctl: number;
    if (q.duration !== undefined) {
      dP50 = atPctl(q.duration, 50);
      dPctl = atPctl(q.duration, pctl);
    } else {
      // Derive from max of ops
      const opDurationsP50 = q.ops.map((op) => resolveOpDuration(op.value, 50).duration);
      const opDurationsPctl = q.ops.map((op) => resolveOpDuration(op.value, pctl).duration);
      dP50 = Math.max(0, ...opDurationsP50);
      dPctl = Math.max(0, ...opDurationsPctl);
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

  function schedule(
    nodes: BoundaryInfo[],
    parentFetchEnd: number,
    threadAvailable: number,
  ): number {
    let thread = threadAvailable;
    for (const b of nodes) {
      const fetchDuration = fetchByPath.get(b.path) ?? 0;
      const renderCost = atPctl(b.renderCost, pctl, 1);
      const fetchStart = parentFetchEnd;
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

  schedule(ssrBoundaries, 0, 0);

  // Build BoundaryTiming[] with thread simulation
  const ssrTimings: WaterfallTiming[] = scheduled.map((s) => {
    const queryName = s.info.queries[0]?.queryName ?? "";
    const isCached = s.info.queries.length > 0 &&
      s.info.queries[0].ops.every((op) => {
        const resolved = resolveOpDuration(op.value, pctl);
        return resolved.cached;
      });

    // Determine color from the heaviest subgraph (highest p99 duration)
    let subgraphColor: string | undefined;
    let maxOpDuration = 0;
    for (const q of s.info.queries) {
      for (const op of q.ops) {
        const { duration, cached } = resolveOpDuration(op.value, 99);
        if (!cached && duration > maxOpDuration) {
          maxOpDuration = duration;
          subgraphColor = colorMap.get(op.subgraphName);
        }
      }
    }

    return {
      name: s.info.name,
      boundaryPath: s.info.path,
      wallStart: Math.round(s.wallStart),
      fetchDuration: isCached ? 0 : Math.round(s.fetchDuration),
      renderCost: Math.round(s.renderCost),
      blocked: 0,
      total: Math.round(s.fetchDuration + s.renderCost),
      lcpCritical: s.info.lcpCritical,
      queryName,
      cached: isCached,
      subgraphColor,
    };
  });

  // CSR timings
  const csrTimings: WaterfallCsrTiming[] = [];
  if (csrBoundaries.length > 0) {
    const csrFlat = flattenTree(csrBoundaries);
    let csrWallStart = hydrationMs;
    for (const b of csrFlat) {
      const q = b.queries[0];
      let fetchDuration = 0;
      if (q) {
        if (q.duration !== undefined) {
          fetchDuration = atPctl(q.duration, 50); // CSR uses ~p50 in waterfall
        } else {
          const opDurations = q.ops.map((op) => resolveOpDuration(op.value, 50).duration);
          fetchDuration = Math.max(0, ...opDurations);
        }
      }
      csrTimings.push({
        name: b.name,
        boundaryPath: b.path,
        wallStart: Math.round(csrWallStart),
        fetchDuration: Math.round(fetchDuration),
        queryName: q?.queryName ?? "",
      });
      csrWallStart += fetchDuration + atPctl(b.renderCost, pctl, 1);
    }
  }

  return { ssrTimings, csrTimings, hydrationMs, initializationMs, navigationTiming: navTiming, loafEntries };
}

// ---- Tree computation ----

function computeTree(
  ssrRoots: BoundaryInfo[],
  csrRoots: BoundaryInfo[],
  pctl: number,
  colorMap: Map<string, string>,
  sloMap: Map<string, number>,
): MockTreeData {
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
  function scheduleBoundaries(roots: BoundaryInfo[], parentFetchEnd: number) {
    for (const b of roots) {
      let boundaryFetch = 0;
      if (b.queries.length > 0) {
        const q = b.queries[0];
        if (q.duration !== undefined) {
          boundaryFetch = atPctl(q.duration, pctl);
        } else {
          const opDurations = q.ops.map((op) => resolveOpDuration(op.value, pctl).duration);
          boundaryFetch = Math.max(0, ...opDurations);
        }
      }
      wallStartByPath.set(b.path, parentFetchEnd);
      // Children fetch concurrently after parent fetch completes
      scheduleBoundaries(b.children, parentFetchEnd + boundaryFetch);
    }
  }
  scheduleBoundaries(ssrRoots, 0);
  // CSR boundaries (if passed separately) start after hydration — but we don't
  // have hydrationMs here, so just use 0-based offsets
  if (csrRoots.length > 0) {
    scheduleBoundaries(csrRoots, 0);
  }

  const nodes: MockTreeNode[] = [];
  let uncachedOps = 0;
  let cachedOps = 0;

  for (const b of allBoundaries) {
    const depth = getDepth(b.path);
    const hasChildren = b.children.length > 0 || b.queries.length > 0;

    // Query-level fetch for the boundary row
    let boundaryFetch = 0;
    if (b.queries.length > 0) {
      const q = b.queries[0];
      if (q.duration !== undefined) {
        boundaryFetch = atPctl(q.duration, pctl);
      } else {
        const opDurations = q.ops.map((op) => resolveOpDuration(op.value, pctl).duration);
        boundaryFetch = Math.max(0, ...opDurations);
      }
    }

    const renderCost = atPctl(b.renderCost, pctl, 1);
    const total = boundaryFetch + renderCost;
    const wallStart = wallStartByPath.get(b.path) ?? 0;

    nodes.push({
      name: b.name,
      path: b.path,
      depth,
      type: "boundary",
      boundaryPath: b.path,
      wallStartPctl: Math.round(wallStart),
      fetchPctl: boundaryFetch,
      renderCostPctl: renderCost,
      blockedPctl: 0,
      totalPctl: total,
      slo: 0,
      lcpCritical: b.lcpCritical,
      cached: false,
      hasChildren,
      phase: b.phase,
    });

    // Query nodes
    for (let qi = 0; qi < b.queries.length; qi++) {
      const q = b.queries[qi];
      let queryDuration: number;
      if (q.duration !== undefined) {
        queryDuration = atPctl(q.duration, pctl);
      } else {
        const opDurations = q.ops.map((op) => resolveOpDuration(op.value, pctl).duration);
        queryDuration = Math.max(0, ...opDurations);
      }
      const isCached = q.ops.length > 0 && q.ops.every((op) => resolveOpDuration(op.value, pctl).cached);

      nodes.push({
        name: q.queryName,
        path: `${b.path}.query${qi > 0 ? qi : ""}`,
        depth: depth + 1,
        type: "query",
        boundaryPath: b.path,
        wallStartPctl: 0,
        fetchPctl: isCached ? 0 : queryDuration,
        renderCostPctl: 0,
        blockedPctl: 0,
        totalPctl: isCached ? 0 : queryDuration,
        slo: 0,
        lcpCritical: false,
        cached: isCached,
        hasChildren: false,
        phase: b.phase,
      });

      // Group ops by subgraph
      const opsBySubgraph = new Map<string, { durations: number[]; cached: boolean }>();
      for (const op of q.ops) {
        const { duration, cached } = resolveOpDuration(op.value, pctl);
        if (cached) cachedOps++; else uncachedOps++;

        const existing = opsBySubgraph.get(op.subgraphName);
        if (existing) {
          existing.durations.push(duration);
          existing.cached = existing.cached && cached;
        } else {
          opsBySubgraph.set(op.subgraphName, { durations: [duration], cached });
        }
      }

      let oi = 0;
      for (const [sgName, sgData] of opsBySubgraph) {
        const sgSlo = sloMap.get(sgName) ?? 0;
        const subgraphColor = colorMap.get(sgName) ?? DEFAULT_SUBGRAPH_COLOR;
        const maxDuration = Math.max(0, ...sgData.durations);

        nodes.push({
          name: sgName,
          path: `${b.path}.query${qi > 0 ? qi : ""}.op${oi > 0 ? oi : ""}`,
          depth: depth + 2,
          type: "subgraph-op",
          boundaryPath: b.path,
          wallStartPctl: 0,
          fetchPctl: sgData.cached ? 0 : maxDuration,
          renderCostPctl: 0,
          blockedPctl: 0,
          totalPctl: sgData.cached ? 0 : maxDuration,
          slo: sgSlo,
          lcpCritical: false,
          cached: sgData.cached,
          subgraphName: sgName,
          subgraphColor,
          hasChildren: false,
          phase: b.phase,
        });
        oi++;
      }
    }
  }

  // Thread simulation for boundary blocked_ms
  const boundaryNodes = nodes.filter((n) => n.type === "boundary" && n.renderCostPctl > 0);
  const sortedByFetchEnd = [...boundaryNodes].sort(
    (a, b) => (a.wallStartPctl + a.fetchPctl) - (b.wallStartPctl + b.fetchPctl),
  );
  let threadCursor = 0;
  for (const bn of sortedByFetchEnd) {
    const fetchEnd = bn.wallStartPctl + bn.fetchPctl;
    const renderStart = Math.max(threadCursor, fetchEnd);
    bn.blockedPctl = Math.max(0, Math.round(renderStart - fetchEnd));
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
): MockSubgraphData {
  const allBoundaries = [...flattenTree(ssrRoots), ...flattenTree(csrRoots)];

  let ssrUncached = 0;
  let csrUncached = 0;
  let totalCached = 0;

  // Collect all ops — keyed by (opName, queryName, boundaryPath, phase) to
  // correctly track isClient per call site rather than collapsing across phases
  const opsBySubgraph = new Map<string, {
    ops: Map<string, {
      opName: string;
      durations: number[];
      boundaries: Set<string>;
      queryNames: Set<string>;
      isClient: boolean;
      cached: boolean;
    }>;
  }>();

  for (const b of allBoundaries) {
    for (const q of b.queries) {
      for (const op of q.ops) {
        const { duration, cached } = resolveOpDuration(op.value, pctl);

        if (cached) totalCached++;
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
            durations: [],
            boundaries: new Set(),
            queryNames: new Set(),
            isClient: op.phase === "csr",
            cached,
          };
          sg.ops.set(opKey, opData);
        }

        if (!cached) opData.durations.push(duration);
        opData.boundaries.add(op.boundaryPath);
        opData.queryNames.add(op.queryName);
      }
    }
  }

  const rows: MockSubgraphRow[] = [];
  for (const [sgName, sg] of opsBySubgraph) {
    const color = colorMap.get(sgName) ?? DEFAULT_SUBGRAPH_COLOR;
    const operations: MockOperationDetail[] = [];

    let sgMaxDuration = 0;
    let sgUncachedCount = 0;

    for (const [, opData] of sg.ops) {
      const uncachedCount = opData.durations.length;
      sgUncachedCount += uncachedCount;
      const durationPctl = opData.durations.length > 0
        ? Math.max(...opData.durations)
        : 0;
      if (durationPctl > sgMaxDuration) sgMaxDuration = durationPctl;

      operations.push({
        name: opData.opName,
        callsPerReq: uncachedCount,
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
      durationPctl: sgMaxDuration,
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

export function parseYamlDashboard(yamlString: string): MockDashboardData {
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

  // Collect full tree structure (CSR boundaries are nested inline with csr: true)
  const allRoots: BoundaryInfo[] = [];
  for (const [name, node] of Object.entries(doc.boundaries)) {
    allRoots.push(collectBoundaryTree(name, node, "", "ssr"));
  }

  // Legacy support: standalone csr_boundaries section
  if (doc.csr_boundaries) {
    for (const [name, node] of Object.entries(doc.csr_boundaries)) {
      allRoots.push(collectBoundaryTree(name, node, "csr", "csr"));
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
  if (doc.subgraphs) {
    for (const [name, cfg] of Object.entries(doc.subgraphs)) {
      subgraphSloMap.set(name, cfg?.slo ?? 0);
    }
  }

  // Compute pre-computed data for each percentile
  const waterfall: Record<number, MockWaterfallData> = {};
  const tree: Record<number, MockTreeData> = {};
  const subgraphs: Record<number, MockSubgraphData> = {};

  for (const pctl of PCTLS) {
    const hydrationMs = Math.round(atPctl(doc.hydration_ms, pctl));
    const initializationMs = doc.initialization_ms
      ? Math.round(atPctl(doc.initialization_ms, pctl))
      : 0;

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
    const loafEntries: MockLoAFEntry[] = (doc.loaf_entries ?? []).map((e) => ({
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

    waterfall[pctl] = computeWaterfall(ssrRoots, csrRoots, pctl, hydrationMs, initializationMs, navTiming, loafEntries, subgraphColorMap);
    // Tree uses the full (un-split) roots so CSR boundaries stay nested under parents
    tree[pctl] = computeTree(allRoots, [], pctl, subgraphColorMap, subgraphSloMap);
    subgraphs[pctl] = computeSubgraphs(ssrRoots, csrRoots, pctl, subgraphColorMap, subgraphSloMap);
  }

  return { route: doc.route, waterfall, tree, subgraphs };
}
