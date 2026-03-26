/**
 * Converts live ClientMetrics (raw sample arrays from localStorage)
 * into MockDashboardData (pre-computed per-percentile views).
 *
 * This allows all dashboard components to consume a single data shape,
 * regardless of whether data came from YAML import or live recording.
 */

import type { ClientMetrics } from "./client-metrics-store";
import type {
  BoundaryMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "./metrics-store";
import {
  SUBGRAPHS,
  type SubgraphName,
} from "./gql-federation";
import { percentile, median } from "./percentile";
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

const PCTLS = [50, 75, 90, 95, 99];

// ---- Tree structure building (extracted from BoundaryTreeTable) ----

interface TreeItem {
  path: string;
  name: string;
  type: "boundary" | "query" | "subgraph-op";
  boundaryPath: string;
  queryName?: string;
  opName?: string;
  subgraphName?: string;
  lcpCritical?: boolean;
  phase?: "ssr" | "csr";
}

function getParentPath(path: string): string | null {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? null : path.substring(0, idx);
}

function buildTreeFromMetrics(
  boundaries: BoundaryMetric[],
  queries: QueryMetric[],
  subgraphOps: SubgraphOperationMetric[],
): TreeItem[] {
  // 1. Collect unique boundary paths with median wall_start_ms
  const wallStartsByPath = new Map<string, number[]>();
  const lcpByPath = new Map<string, boolean>();
  const phaseByPath = new Map<string, "ssr" | "csr">();
  for (const b of boundaries) {
    const list = wallStartsByPath.get(b.boundary_path) ?? [];
    list.push(b.wall_start_ms);
    wallStartsByPath.set(b.boundary_path, list);
    if (b.is_lcp_critical) lcpByPath.set(b.boundary_path, true);
    phaseByPath.set(b.boundary_path, b.phase ?? "ssr");
  }

  const allPaths = [...wallStartsByPath.keys()];
  const medianByPath = new Map<string, number>();
  for (const path of allPaths) {
    medianByPath.set(path, median(wallStartsByPath.get(path)!));
  }

  // 2. Build parent→children map
  const childrenOf = new Map<string | null, string[]>();
  const sortedPaths = [...allPaths].sort((a, b) => a.length - b.length);

  for (const path of sortedPaths) {
    let parent: string | null = null;
    let candidate = getParentPath(path);
    while (candidate !== null) {
      if (wallStartsByPath.has(candidate)) {
        parent = candidate;
        break;
      }
      candidate = getParentPath(candidate);
    }
    const siblings = childrenOf.get(parent) ?? [];
    siblings.push(path);
    childrenOf.set(parent, siblings);
  }

  for (const [, children] of childrenOf) {
    children.sort((a, b) => (medianByPath.get(a) ?? 0) - (medianByPath.get(b) ?? 0));
  }

  // 3. Collect unique queries per boundary
  const queriesByBoundary = new Map<string, Set<string>>();
  for (const q of queries) {
    const set = queriesByBoundary.get(q.boundary_path) ?? new Set();
    set.add(q.queryName);
    queriesByBoundary.set(q.boundary_path, set);
  }

  // 4. Collect unique subgraphs per (boundary, query)
  const subgraphsByBoundaryQuery = new Map<string, Set<string>>();
  for (const op of subgraphOps) {
    const key = `${op.boundary_path}:${op.queryName}`;
    const sgSet = subgraphsByBoundaryQuery.get(key) ?? new Set();
    sgSet.add(op.subgraphName);
    subgraphsByBoundaryQuery.set(key, sgSet);
  }

  // 5. DFS walk the tree
  const items: TreeItem[] = [];

  function walk(parentPath: string | null) {
    const children = childrenOf.get(parentPath) ?? [];
    for (const boundaryPath of children) {
      const name = boundaryPath.split(".").pop()!;

      items.push({
        path: boundaryPath,
        name,
        type: "boundary",
        boundaryPath,
        lcpCritical: lcpByPath.get(boundaryPath) ?? false,
        phase: phaseByPath.get(boundaryPath),
      });

      const queryNames = queriesByBoundary.get(boundaryPath);
      if (queryNames) {
        let queryIdx = 0;
        for (const queryName of queryNames) {
          const queryPath = `${boundaryPath}.query${queryIdx > 0 ? queryIdx : ""}`;
          items.push({
            path: queryPath,
            name: queryName,
            type: "query",
            boundaryPath,
            queryName,
            phase: phaseByPath.get(boundaryPath),
          });

          const sgKey = `${boundaryPath}:${queryName}`;
          const sgs = subgraphsByBoundaryQuery.get(sgKey);
          if (sgs) {
            let opIdx = 0;
            for (const subgraphName of sgs) {
              items.push({
                path: `${queryPath}.op${opIdx > 0 ? opIdx : ""}`,
                name: subgraphName,
                type: "subgraph-op",
                boundaryPath,
                queryName,
                opName: subgraphName,
                subgraphName,
                phase: phaseByPath.get(boundaryPath),
              });
              opIdx++;
            }
          }
          queryIdx++;
        }
      }

      walk(boundaryPath);
    }
  }

  walk(null);
  return items;
}

// ---- Waterfall computation from live metrics ----

function computeWaterfallFromLive(
  metrics: ClientMetrics,
  pctl: number,
): MockWaterfallData {
  const ssrBoundaries = metrics.boundaries.filter((b) => b.phase !== "csr");
  const csrBoundaries = metrics.boundaries.filter((b) => b.phase === "csr");
  const ssrQueries = metrics.queries.filter((q) => q.phase !== "csr");
  const csrQueries = metrics.queries.filter((q) => q.phase === "csr");

  // Select a representative page load at the target percentile
  const byRequest = new Map<string, BoundaryMetric[]>();
  for (const b of ssrBoundaries) {
    const list = byRequest.get(b.requestId) ?? [];
    list.push(b);
    byRequest.set(b.requestId, list);
  }

  const loadTimes: { requestId: string; pageTime: number }[] = [];
  for (const [requestId, bMetrics] of byRequest) {
    const pageTime = Math.max(...bMetrics.map((m) => m.wall_start_ms + m.render_duration_ms));
    loadTimes.push({ requestId, pageTime });
  }
  loadTimes.sort((a, b) => a.pageTime - b.pageTime);

  const idx = loadTimes.length > 0
    ? Math.min(Math.max(0, Math.ceil((pctl / 100) * loadTimes.length) - 1), loadTimes.length - 1)
    : -1;
  const representativeRequestId = idx >= 0 ? loadTimes[idx]?.requestId ?? null : null;

  // Build SSR timings from representative load
  let ssrTimings: WaterfallTiming[] = [];
  if (representativeRequestId) {
    const repBoundaries = ssrBoundaries.filter((b) => b.requestId === representativeRequestId);
    const repQueries = ssrQueries.filter((q) => q.requestId === representativeRequestId);

    const queryNamesByPath = new Map<string, string[]>();
    const queryByKey = new Map<string, QueryMetric[]>();
    for (const q of repQueries) {
      const names = queryNamesByPath.get(q.boundary_path) ?? [];
      if (!names.includes(q.queryName)) names.push(q.queryName);
      queryNamesByPath.set(q.boundary_path, names);
      const key = `${q.boundary_path}:${q.queryName}`;
      const list = queryByKey.get(key) ?? [];
      list.push(q);
      queryByKey.set(key, list);
    }

    ssrTimings = repBoundaries
      .sort((a, b) => a.wall_start_ms - b.wall_start_ms)
      .map((m) => {
        const name = m.boundary_path.split(".").pop()!;
        const queryNames = queryNamesByPath.get(m.boundary_path) ?? [];
        const queryName = queryNames[0] ?? "";

        const allQMetrics = queryNames.flatMap(
          (qn) => queryByKey.get(`${m.boundary_path}:${qn}`) ?? [],
        );
        const isMemoized = allQMetrics.length > 0 && allQMetrics.every((q) => q.fullyCached);

        return {
          name,
          boundaryPath: m.boundary_path,
          wallStart: m.wall_start_ms,
          fetchDuration: isMemoized ? 0 : (m.fetch_duration_ms ?? m.render_duration_ms),
          renderCost: m.render_cost_ms ?? 0,
          blocked: 0,
          total: m.render_duration_ms,
          lcpCritical: m.is_lcp_critical,
          queryName,
          queryNames,
          memoized: isMemoized,
        };
      });

    // Thread simulation for blocked_ms
    const sortedByFetchEnd = [...ssrTimings]
      .filter((t) => t.renderCost > 0)
      .sort((a, b) => (a.wallStart + a.fetchDuration) - (b.wallStart + b.fetchDuration));
    let cursor = 0;
    for (const t of sortedByFetchEnd) {
      const fetchEnd = t.wallStart + t.fetchDuration;
      const renderStart = Math.max(cursor, fetchEnd);
      t.blocked = Math.max(0, Math.round(renderStart - fetchEnd));
      cursor = renderStart + t.renderCost;
    }
  }

  // Build CSR timings from representative load
  let csrTimingsList: WaterfallCsrTiming[] = [];
  if (representativeRequestId && csrBoundaries.length > 0) {
    const repCsr = csrBoundaries.filter((b) => b.requestId === representativeRequestId);
    const repCsrQueries = csrQueries.filter((q) => q.requestId === representativeRequestId);

    const csrQueryNamesByPath = new Map<string, string[]>();
    for (const q of repCsrQueries) {
      const names = csrQueryNamesByPath.get(q.boundary_path) ?? [];
      if (!names.includes(q.queryName)) names.push(q.queryName);
      csrQueryNamesByPath.set(q.boundary_path, names);
    }

    csrTimingsList = repCsr
      .sort((a, b) => a.wall_start_ms - b.wall_start_ms)
      .map((m) => {
        const queryNames = csrQueryNamesByPath.get(m.boundary_path) ?? [];
        return {
          name: m.boundary_path.split(".").pop()!,
          boundaryPath: m.boundary_path,
          wallStart: m.wall_start_ms,
          fetchDuration: m.fetch_duration_ms ?? m.render_duration_ms,
          queryName: queryNames[0] ?? "",
          queryNames,
        };
      });
  }

  // Hydration, LoAF, navigation timing from representative load
  const hydrationMs = representativeRequestId && metrics.hydrationTimes
    ? metrics.hydrationTimes[representativeRequestId] ?? 0
    : 0;

  const rawLoaf = representativeRequestId && metrics.loafEntries
    ? metrics.loafEntries[representativeRequestId] ?? []
    : [];
  const loafEntries: MockLoAFEntry[] = rawLoaf.map((e) => ({
    startTime: e.startTime,
    duration: e.duration,
    blockingDuration: e.blockingDuration,
    scripts: e.scripts.map((s) => ({
      sourceURL: s.sourceURL,
      sourceFunctionName: s.sourceFunctionName,
      duration: s.duration,
    })),
  }));

  const rawNavTiming = representativeRequestId && metrics.navigationTimings
    ? metrics.navigationTimings[representativeRequestId] ?? null
    : null;

  return {
    ssrTimings,
    csrTimings: csrTimingsList,
    hydrationMs,
    initializationMs: 0,
    navigationTiming: rawNavTiming,
    loafEntries,
    networkOffsetMs: 20,
    lcpImageLatencyMs: 80,
  };
}

// ---- Tree computation from live metrics ----

function computeTreeFromLive(
  metrics: ClientMetrics,
  pctl: number,
): MockTreeData {
  const { boundaries, queries, subgraphOps } = metrics;

  if (boundaries.length === 0 && queries.length === 0) {
    return { nodes: [], callSummary: null };
  }

  const treeStructure = buildTreeFromMetrics(boundaries, queries, subgraphOps);

  // Group metrics by key
  const boundaryByPath = new Map<string, BoundaryMetric[]>();
  for (const b of boundaries) {
    const list = boundaryByPath.get(b.boundary_path) ?? [];
    list.push(b);
    boundaryByPath.set(b.boundary_path, list);
  }

  const queryByKey = new Map<string, QueryMetric[]>();
  for (const q of queries) {
    const key = `${q.boundary_path}:${q.queryName}`;
    const list = queryByKey.get(key) ?? [];
    list.push(q);
    queryByKey.set(key, list);
  }

  // Compute depth for each boundary
  const depthMap = new Map<string, number>();
  const allBoundaryPathsSet = new Set(
    treeStructure.filter((t) => t.type === "boundary").map((t) => t.boundaryPath),
  );
  for (const path of allBoundaryPathsSet) {
    let depth = 0;
    let candidate = getParentPath(path);
    while (candidate !== null) {
      if (allBoundaryPathsSet.has(candidate)) depth++;
      candidate = getParentPath(candidate);
    }
    depthMap.set(path, depth);
  }

  // Which boundaries have children?
  const boundaryHasChildren = new Set<string>();
  for (const item of treeStructure) {
    if (item.type !== "boundary") {
      boundaryHasChildren.add(item.boundaryPath);
    }
  }
  for (const path of allBoundaryPathsSet) {
    let candidate = getParentPath(path);
    while (candidate !== null) {
      if (allBoundaryPathsSet.has(candidate)) {
        boundaryHasChildren.add(candidate);
        break;
      }
      candidate = getParentPath(candidate);
    }
  }

  // Build lookup of actual (non-cached) durations for queries and ops
  const actualQueryDuration = new Map<string, number[]>();
  for (const q of queries) {
    if (!q.fullyCached) {
      const list = actualQueryDuration.get(q.queryName) ?? [];
      list.push(q.duration_ms);
      actualQueryDuration.set(q.queryName, list);
    }
  }
  const actualOpDuration = new Map<string, number[]>();
  for (const op of subgraphOps) {
    if (!op.cached) {
      const key = `${op.queryName}:${op.subgraphName}`;
      const list = actualOpDuration.get(key) ?? [];
      list.push(op.duration_ms);
      actualOpDuration.set(key, list);
    }
  }

  // Collect all subgraph names for color map
  const subgraphNames = new Set<string>();
  for (const item of treeStructure) {
    if (item.subgraphName) subgraphNames.add(item.subgraphName);
  }
  const colorMap = buildSubgraphColorMap(subgraphNames);

  const nodes: MockTreeNode[] = [];

  for (const item of treeStructure) {
    const depth = item.type === "boundary"
      ? (depthMap.get(item.boundaryPath) ?? 0)
      : item.type === "query"
        ? (depthMap.get(item.boundaryPath) ?? 0) + 1
        : (depthMap.get(item.boundaryPath) ?? 0) + 2;

    if (item.type === "boundary") {
      const bMetrics = boundaryByPath.get(item.boundaryPath) ?? [];
      const wallStarts = bMetrics.map((m) => m.wall_start_ms);
      const fetchDurations = bMetrics.map((m) => m.fetch_duration_ms ?? m.render_duration_ms);
      const renderCosts = bMetrics.map((m) => m.render_cost_ms ?? 0);

      nodes.push({
        name: item.name,
        path: item.path,
        depth,
        type: "boundary",
        boundaryPath: item.boundaryPath,
        queryLatencyPctl: percentile(fetchDurations, pctl),
        subgraphLatencyPctl: 0,
        querySlo: 0,
        subgraphSlo: 0,
        weight: 0,
        lcpCritical: item.lcpCritical ?? false,
        memoized: false,
        prefetch: false,
        hasChildren: boundaryHasChildren.has(item.boundaryPath),
        phase: item.phase,
        wallStartPctl: percentile(wallStarts, pctl),
        renderCostPctl: percentile(renderCosts, pctl),
      });
    } else if (item.type === "query") {
      const key = `${item.boundaryPath}:${item.queryName}`;
      const qMetrics = queryByKey.get(key) ?? [];
      const durations = qMetrics.map((m) => m.duration_ms);
      const isCached = qMetrics.length > 0 && qMetrics.every((m) => m.fullyCached);
      const sourceDurations = isCached
        ? (actualQueryDuration.get(item.queryName!) ?? durations)
        : durations;
      const queryDurationPctl = percentile(sourceDurations, pctl);

      nodes.push({
        name: item.queryName!,
        path: item.path,
        depth,
        type: "query",
        boundaryPath: item.boundaryPath,
        queryLatencyPctl: queryDurationPctl,
        subgraphLatencyPctl: 0,
        querySlo: 0,
        subgraphSlo: 0,
        weight: 0,
        lcpCritical: false,
        memoized: isCached,
        prefetch: false,
        hasChildren: false,
        phase: item.phase,
        wallStartPctl: 0,
        renderCostPctl: 0,
      });
    } else {
      // subgraph-op
      const sgName = item.subgraphName!;
      const sgSlo = SUBGRAPHS[sgName as SubgraphName]?.sloMs ?? 0;
      const subgraphColor = colorMap.get(sgName) ?? DEFAULT_SUBGRAPH_COLOR;

      const matchingOps: SubgraphOperationMetric[] = [];
      for (const op of subgraphOps) {
        if (op.boundary_path === item.boundaryPath && op.queryName === item.queryName && op.subgraphName === sgName) {
          matchingOps.push(op);
        }
      }
      const durations = matchingOps.map((m) => m.duration_ms);
      const isCached = matchingOps.length > 0 && matchingOps.every((m) => m.cached);
      const sourceDurations = isCached
        ? (actualOpDuration.get(`${item.queryName}:${sgName}`) ?? durations)
        : durations;
      const durationPctl = percentile(sourceDurations, pctl);

      nodes.push({
        name: sgName,
        path: item.path,
        depth,
        type: "subgraph-op",
        boundaryPath: item.boundaryPath,
        queryLatencyPctl: durationPctl,
        subgraphLatencyPctl: durationPctl,
        querySlo: 0,
        subgraphSlo: sgSlo,
        weight: 0,
        lcpCritical: false,
        memoized: isCached,
        prefetch: false,
        subgraphName: sgName,
        subgraphColor,
        hasChildren: false,
        phase: item.phase,
        wallStartPctl: 0,
        renderCostPctl: 0,
      });
    }
  }

  // Thread simulation for boundary blocked_ms (internal, not displayed)
  const boundaryNodes = nodes.filter((n) => n.type === "boundary" && n.renderCostPctl > 0);
  const sorted = [...boundaryNodes].sort((a, b) =>
    (a.wallStartPctl + a.queryLatencyPctl) - (b.wallStartPctl + b.queryLatencyPctl),
  );
  let threadCursor = 0;
  for (const bn of sorted) {
    const fetchEnd = bn.wallStartPctl + bn.queryLatencyPctl;
    const renderStart = Math.max(threadCursor, fetchEnd);
    threadCursor = renderStart + bn.renderCostPctl;
  }

  // Call summary
  const requestIds = new Set(subgraphOps.map((o) => o.requestId));
  const numRequests = requestIds.size;
  const uncachedOps = subgraphOps.filter((o) => !o.cached).length;
  const cachedOps = subgraphOps.filter((o) => o.cached).length;
  const callSummary = numRequests > 0
    ? {
        callsPerReq: Math.round((uncachedOps / numRequests) * 10) / 10,
        dedupedPerReq: Math.round((cachedOps / numRequests) * 10) / 10,
      }
    : null;

  return { nodes, callSummary };
}

// ---- Subgraph computation from live metrics ----

function computeSubgraphsFromLive(
  metrics: ClientMetrics,
  pctl: number,
): MockSubgraphData {
  const { subgraphOps } = metrics;

  if (subgraphOps.length === 0) {
    return { summary: { ssrCallsPerReq: 0, csrCallsPerReq: 0, dedupedPerReq: 0 }, rows: [] };
  }

  const requestIds = new Set(subgraphOps.map((o) => o.requestId));
  const numRequests = requestIds.size;

  let ssrUncached = 0;
  let csrUncached = 0;
  let totalCached = 0;
  for (const op of subgraphOps) {
    if (op.cached) totalCached++;
    else if (op.phase === "csr") csrUncached++;
    else ssrUncached++;
  }

  const summary = {
    ssrCallsPerReq: Math.round((ssrUncached / numRequests) * 10) / 10,
    csrCallsPerReq: Math.round((csrUncached / numRequests) * 10) / 10,
    dedupedPerReq: Math.round((totalCached / numRequests) * 10) / 10,
  };

  // Collect all subgraph names for color map
  const allSgNames = new Set<string>();
  for (const op of subgraphOps) allSgNames.add(op.subgraphName);
  const colorMap = buildSubgraphColorMap(allSgNames);

  // Group ops by subgraph
  const uncachedBySubgraph = new Map<string, SubgraphOperationMetric[]>();
  const allBySubgraph = new Map<string, SubgraphOperationMetric[]>();
  for (const op of subgraphOps) {
    const allList = allBySubgraph.get(op.subgraphName) ?? [];
    allList.push(op);
    allBySubgraph.set(op.subgraphName, allList);
    if (!op.cached) {
      const list = uncachedBySubgraph.get(op.subgraphName) ?? [];
      list.push(op);
      uncachedBySubgraph.set(op.subgraphName, list);
    }
  }

  const rows: MockSubgraphRow[] = [];

  for (const [sgName, sgUncachedOps] of uncachedBySubgraph) {
    const color = SUBGRAPHS[sgName as SubgraphName]?.color ?? colorMap.get(sgName) ?? DEFAULT_SUBGRAPH_COLOR;
    const sloMs = SUBGRAPHS[sgName as SubgraphName]?.sloMs ?? 0;
    const sgAllOps = allBySubgraph.get(sgName) ?? [];

    // Build unique callers with per-caller durations
    const callerBase = new Map<string, { queryName: string; boundary: string; isClient: boolean }>();
    const callerDurations = new Map<string, number[]>();
    for (const op of sgAllOps) {
      const key = `${op.queryName}:${op.boundary_path}`;
      if (!callerBase.has(key)) {
        callerBase.set(key, {
          queryName: op.queryName,
          boundary: op.boundary_path,
          isClient: op.phase === "csr",
        });
      }
      if (!op.cached) {
        const durs = callerDurations.get(key) ?? [];
        durs.push(op.duration_ms);
        callerDurations.set(key, durs);
      }
    }

    const durations = sgUncachedOps.map((o) => o.duration_ms);

    const operations: MockOperationDetail[] = [...callerBase.entries()].map(([key, c]) => ({
      name: c.queryName,
      callsPerReq: Math.round(((callerDurations.get(key)?.length ?? 0) / numRequests) * 10) / 10,
      weight: 0,
      queryLatencyPctl: 0,
      durationPctl: percentile(callerDurations.get(key) ?? [], pctl),
      boundaries: [c.boundary],
      queryNames: [c.queryName],
      isClient: c.isClient,
    }));

    operations.sort((a, b) => b.callsPerReq - a.callsPerReq);

    rows.push({
      name: sgName,
      color,
      sloMs,
      callsPerReq: Math.round((sgUncachedOps.length / numRequests) * 10) / 10,
      subgraphLatencyPctl: percentile(durations, pctl),
      operations,
    });
  }

  rows.sort((a, b) => b.callsPerReq - a.callsPerReq);

  return { summary, rows };
}

// ---- Main entry point ----

export function convertLiveMetrics(metrics: ClientMetrics): MockDashboardData {
  const route = metrics.boundaries[0]?.route ?? "/unknown";

  const waterfall: Record<number, MockWaterfallData> = {};
  const tree: Record<number, MockTreeData> = {};
  const subgraphs: Record<number, MockSubgraphData> = {};

  for (const pctl of PCTLS) {
    waterfall[pctl] = computeWaterfallFromLive(metrics, pctl);
    tree[pctl] = computeTreeFromLive(metrics, pctl);
    subgraphs[pctl] = computeSubgraphsFromLive(metrics, pctl);
  }

  return { route, waterfall, tree, subgraphs };
}
