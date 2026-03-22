"use client";

import { useMemo, useState, useCallback } from "react";
import type {
  BoundaryMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "@/lib/metrics-store";
import {
  SUBGRAPHS,
  type SubgraphName,
} from "@/lib/gql-federation";
import { percentile, median as medianUtil } from "@/lib/percentile";
import type { MockTreeData } from "@/lib/mock-metrics";
import { buildSubgraphColorMap, DEFAULT_SUBGRAPH_COLOR } from "@/lib/subgraph-colors";
import { TabDescription } from "./TabDescription";

interface Props {
  boundaries: BoundaryMetric[];
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  pctl: number;
  /** Pre-computed mock data keyed by percentile */
  mock?: Record<number, MockTreeData>;
}

// --- Tree structure: boundary → query → subgraph-op ---

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

/**
 * Dynamically builds the tree structure from recorded metrics.
 * Boundaries are ordered by median wall_start_ms, with queries and
 * subgraph-ops nested underneath their parent boundary.
 */
/**
 * Returns the parent boundary path for a given path.
 * e.g. "Layout.Content.Main.Hero" → "Layout.Content.Main"
 *      "Layout.Nav" → "Layout"
 *      "Layout" → null
 *      "Layout.Nav.CartIndicator" → "Layout.Nav"
 */
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

  // 2. Build parent→children map, respecting the dot-separated hierarchy.
  //    A path's parent is the longest existing path that is a prefix of it.
  //    e.g. if we have "Layout", "Layout.Content", "Layout.Content.Main.Hero",
  //    then Hero's parent is Layout.Content (not Layout.Content.Main, which doesn't exist).
  const childrenOf = new Map<string | null, string[]>();

  // Sort paths by length so parents are processed before children
  const sortedPaths = [...allPaths].sort((a, b) => a.length - b.length);

  for (const path of sortedPaths) {
    // Walk up the path segments to find the nearest existing ancestor
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

  // Sort each group of siblings by median wall_start_ms
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

  // 4. Collect unique subgraphs per (boundary, query) — grouped by subgraph, not individual op
  const subgraphsByBoundaryQuery = new Map<string, Set<string>>();
  for (const op of subgraphOps) {
    const key = `${op.boundary_path}:${op.queryName}`;
    const sgSet = subgraphsByBoundaryQuery.get(key) ?? new Set();
    sgSet.add(op.subgraphName);
    subgraphsByBoundaryQuery.set(key, sgSet);
  }

  // 5. DFS walk the tree to produce correctly ordered items
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

      // Add queries and subgraph ops under this boundary
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

      // Recurse into child boundaries
      walk(boundaryPath);
    }
  }

  walk(null);
  return items;
}

const median = medianUtil;

interface TreeNode {
  name: string;
  path: string;
  depth: number;
  type: "boundary" | "query" | "subgraph-op";
  boundaryPath: string;
  wallStartPctl: number;
  fetchPctl: number;
  renderCostPctl: number;
  blockedPctl: number;
  totalPctl: number;
  slo: number;
  lcpCritical: boolean;
  cached: boolean;
  subgraphName?: string;
  subgraphColor?: string;
  hasChildren: boolean;
  phase?: "ssr" | "csr";
}

function getDepth(item: TreeItem, depthMap: Map<string, number>): number {
  if (item.type === "boundary") {
    return depthMap.get(item.boundaryPath) ?? 0;
  }
  // Queries and ops indent one/two levels deeper than their boundary
  const boundaryDepth = depthMap.get(item.boundaryPath) ?? 0;
  return item.type === "query" ? boundaryDepth + 1 : boundaryDepth + 2;
}

export function BoundaryTreeTable({ boundaries, queries, subgraphOps, pctl, mock }: Props) {
  // Build tree structure dynamically from recorded metrics (skipped in mock mode)
  const treeStructure = useMemo(
    () => mock ? [] : buildTreeFromMetrics(boundaries, queries, subgraphOps),
    [boundaries, queries, subgraphOps, mock],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastExpandKey, setLastExpandKey] = useState("");

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const treeNodes = useMemo(() => {
    // Mock data path — use pre-computed nodes directly
    if (mock?.[pctl]?.nodes) return mock[pctl].nodes;

    if (boundaries.length === 0 && queries.length === 0) return [];

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

    // Compute depth for each boundary based on tree hierarchy
    const depthMap = new Map<string, number>();
    const allBoundaryPathsSet = new Set(
      treeStructure.filter((t) => t.type === "boundary").map((t) => t.boundaryPath),
    );
    for (const path of allBoundaryPathsSet) {
      let depth = 0;
      let candidate = getParentPath(path);
      while (candidate !== null) {
        if (allBoundaryPathsSet.has(candidate)) {
          depth++;
        }
        candidate = getParentPath(candidate);
      }
      depthMap.set(path, depth);
    }

    // Precompute which boundaries have children (queries, ops, or child boundaries)
    const boundaryHasChildren = new Set<string>();
    for (const item of treeStructure) {
      if (item.type !== "boundary") {
        boundaryHasChildren.add(item.boundaryPath);
      }
    }
    // Also mark boundaries that have child boundaries
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

    const nodes: TreeNode[] = [];

    for (const item of treeStructure) {
      const depth = getDepth(item, depthMap);

      if (item.type === "boundary") {
        const metrics = boundaryByPath.get(item.boundaryPath) ?? [];
        const wallStarts = metrics.map((m) => m.wall_start_ms);
        const durations = metrics.map((m) => m.render_duration_ms);
        const fetchDurations = metrics.map((m) => m.fetch_duration_ms ?? m.render_duration_ms);
        const renderCosts = metrics.map((m) => m.render_cost_ms ?? 0);

        nodes.push({
          name: item.name,
          path: item.path,
          depth,
          type: "boundary",
          boundaryPath: item.boundaryPath,
          wallStartPctl: percentile(wallStarts, pctl),
          fetchPctl: percentile(fetchDurations, pctl),
          renderCostPctl: percentile(renderCosts, pctl),
          blockedPctl: 0,
          totalPctl: percentile(durations, pctl),
          slo: 0,
          lcpCritical: item.lcpCritical ?? false,
          cached: false,
          hasChildren: boundaryHasChildren.has(item.boundaryPath),
          phase: item.phase,
        });
      } else if (item.type === "query") {
        const key = `${item.boundaryPath}:${item.queryName}`;
        const metrics = queryByKey.get(key) ?? [];
        const durations = metrics.map((m) => m.duration_ms);
        const isCached = metrics.length > 0 && metrics.every((m) => m.fullyCached);

        nodes.push({
          name: item.queryName!,
          path: item.path,
          depth,
          type: "query",
          boundaryPath: item.boundaryPath,
          wallStartPctl: 0,
          fetchPctl: isCached ? 0 : percentile(durations, pctl),
          renderCostPctl: 0,
          blockedPctl: 0,
          totalPctl: isCached ? 0 : percentile(durations, pctl),
          slo: 0,
          lcpCritical: false,
          cached: isCached,
          hasChildren: false,
          phase: item.phase,
        });
      } else {
        // Group ops by subgraph — aggregate all ops for this subgraph under this query
        const sgName = item.subgraphName;
        const sgSlo = sgName
          ? SUBGRAPHS[sgName as SubgraphName]?.sloMs ?? 0
          : 0;
        // Collect all ops for this subgraph under this boundary+query
        const matchingOps: SubgraphOperationMetric[] = [];
        for (const op of subgraphOps) {
          if (op.boundary_path === item.boundaryPath && op.queryName === item.queryName && op.subgraphName === sgName) {
            matchingOps.push(op);
          }
        }
        const durations = matchingOps.map((m) => m.duration_ms);
        const isCached = matchingOps.length > 0 && matchingOps.every((m) => m.cached);
        const subgraphColor = sgName
          ? SUBGRAPHS[sgName as SubgraphName]?.color
          : undefined;

        nodes.push({
          name: sgName || item.opName!,
          path: item.path,
          depth,
          type: "subgraph-op",
          boundaryPath: item.boundaryPath,
          wallStartPctl: 0,
          fetchPctl: isCached ? 0 : percentile(durations, pctl),
          renderCostPctl: 0,
          blockedPctl: 0,
          totalPctl: isCached ? 0 : percentile(durations, pctl),
          slo: sgSlo,
          lcpCritical: false,
          cached: isCached,
          subgraphName: item.subgraphName,
          subgraphColor,
          hasChildren: false,
          phase: item.phase,
        });
      }
    }

    // Thread simulation for blocked_ms — uses real percentile fetch durations
    const boundaryNodes = nodes.filter(
      (n) => n.type === "boundary" && n.renderCostPctl > 0
    );
    const sorted = [...boundaryNodes].sort((a, b) => {
      const aEnd = a.wallStartPctl + a.fetchPctl;
      const bEnd = b.wallStartPctl + b.fetchPctl;
      return aEnd - bEnd;
    });
    let threadCursor = 0;
    for (const bn of sorted) {
      const fetchEnd = bn.wallStartPctl + bn.fetchPctl;
      const renderStart = Math.max(threadCursor, fetchEnd);
      const blocked = renderStart - fetchEnd;
      const nodeIdx = nodes.findIndex((n) => n.path === bn.path);
      if (nodeIdx >= 0) {
        nodes[nodeIdx].blockedPctl = Math.max(0, Math.round(blocked));
      }
      threadCursor = renderStart + bn.renderCostPctl;
    }

    return nodes;
  }, [treeStructure, boundaries, queries, subgraphOps, pctl, mock]);

  // Phase filter — null means "show all", "ssr" or "csr" filters to that phase
  const [phaseFilter, setPhaseFilter] = useState<"ssr" | "csr" | null>(null);
  const togglePhaseFilter = useCallback((phase: "ssr" | "csr") => {
    setPhaseFilter((prev) => (prev === phase ? null : phase));
  }, []);

  // LCP path filter
  const [lcpFilter, setLcpFilter] = useState(false);
  const toggleLcpFilter = useCallback(() => setLcpFilter((prev) => !prev), []);

  // Subgraph filter — empty means "show all"
  const [showSubgraphFilters, setShowSubgraphFilters] = useState(false);
  const [selectedSubgraphs, setSelectedSubgraphs] = useState<Set<string>>(new Set());
  const toggleSubgraphFilter = useCallback((name: string) => {
    setSelectedSubgraphs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  const clearSubgraphFilter = useCallback(() => setSelectedSubgraphs(new Set()), []);

  // Derive available subgraphs dynamically from the actual data
  const availableSubgraphs = useMemo(() => {
    const names = new Set<string>();
    for (const n of treeNodes) {
      if (n.type === "subgraph-op" && n.subgraphName) {
        names.add(n.subgraphName);
      }
    }
    return [...names].sort();
  }, [treeNodes]);

  // Dynamic color map for subgraphs present in the data
  const subgraphColorMap = useMemo(
    () => buildSubgraphColorMap(availableSubgraphs),
    [availableSubgraphs],
  );

  // SLO-based filters
  const [sloExceededFilter, setSloExceededFilter] = useState(false);
  const toggleSloExceededFilter = useCallback(() => setSloExceededFilter((prev) => !prev), []);
  const [noSloFilter, setNoSloFilter] = useState(false);
  const toggleNoSloFilter = useCallback(() => setNoSloFilter((prev) => !prev), []);

  // Compute boundaries with subgraphs exceeding SLO
  const sloExceededPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const n of treeNodes) {
      if (n.type === "subgraph-op" && !n.cached && n.slo > 0 && n.fetchPctl > n.slo) {
        paths.add(n.boundaryPath);
        let candidate = getParentPath(n.boundaryPath);
        while (candidate !== null) {
          paths.add(candidate);
          candidate = getParentPath(candidate);
        }
      }
    }
    return paths;
  }, [treeNodes]);

  // Compute boundaries with subgraphs that have no SLO
  const noSloPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const n of treeNodes) {
      if (n.type === "subgraph-op" && !n.cached && n.slo === 0) {
        paths.add(n.boundaryPath);
        let candidate = getParentPath(n.boundaryPath);
        while (candidate !== null) {
          paths.add(candidate);
          candidate = getParentPath(candidate);
        }
      }
    }
    return paths;
  }, [treeNodes]);

  // Compute LCP path boundary set (LCP boundaries + ancestors)
  const lcpBoundaryPaths = useMemo(() => {
    const lcpPaths = new Set<string>();
    // Derive from treeNodes (works for both live and mock)
    for (const n of treeNodes) {
      if (n.lcpCritical) lcpPaths.add(n.boundaryPath);
    }
    // Add all ancestor boundaries
    const withAncestors = new Set(lcpPaths);
    for (const path of lcpPaths) {
      let candidate = getParentPath(path);
      while (candidate !== null) {
        withAncestors.add(candidate);
        candidate = getParentPath(candidate);
      }
    }
    return withAncestors;
  }, [treeNodes]);

  // Compute which boundaries match the phase filter
  const phaseBoundaryPaths = useMemo(() => {
    if (!phaseFilter) return null;
    const matching = new Set<string>();
    for (const n of treeNodes) {
      // Treat undefined/missing phase as "ssr" (SSR boundaries don't explicitly set phase)
      const nodePhase = n.phase ?? "ssr";
      if (n.type === "boundary" && nodePhase === phaseFilter) {
        matching.add(n.boundaryPath);
        // Include ancestors so the tree structure stays visible
        let candidate = getParentPath(n.boundaryPath);
        while (candidate !== null) {
          matching.add(candidate);
          candidate = getParentPath(candidate);
        }
      }
    }
    return matching;
  }, [phaseFilter, treeNodes]);

  // Compute which boundaries match the subgraph filter
  const filteredBoundaryPaths = useMemo(() => {
    const hasSubgraphFilter = selectedSubgraphs.size > 0;
    if (!hasSubgraphFilter && !lcpFilter && !phaseFilter && !sloExceededFilter && !noSloFilter) return null; // no filter

    const subgraphMatching = new Set<string>();
    if (hasSubgraphFilter) {
      // Collect matching boundaries
      const directMatches = new Set<string>();
      if (mock) {
        for (const n of treeNodes) {
          if (n.type === "subgraph-op" && n.subgraphName && selectedSubgraphs.has(n.subgraphName)) {
            directMatches.add(n.boundaryPath);
          }
        }
      } else {
        for (const op of subgraphOps) {
          if (selectedSubgraphs.has(op.subgraphName)) {
            directMatches.add(op.boundary_path);
          }
        }
      }
      // Include ancestors so the tree hierarchy stays visible
      for (const p of directMatches) {
        subgraphMatching.add(p);
        let candidate = getParentPath(p);
        while (candidate !== null) {
          subgraphMatching.add(candidate);
          candidate = getParentPath(candidate);
        }
      }
    }

    // Combine all active filters with intersection
    let result: Set<string> | null = null;

    if (hasSubgraphFilter) result = subgraphMatching;
    if (lcpFilter) {
      result = result
        ? new Set([...result].filter((p) => lcpBoundaryPaths.has(p)))
        : lcpBoundaryPaths;
    }
    if (phaseBoundaryPaths) {
      result = result
        ? new Set([...result].filter((p) => phaseBoundaryPaths.has(p)))
        : phaseBoundaryPaths;
    }
    if (sloExceededFilter) {
      result = result
        ? new Set([...result].filter((p) => sloExceededPaths.has(p)))
        : sloExceededPaths;
    }
    if (noSloFilter) {
      result = result
        ? new Set([...result].filter((p) => noSloPaths.has(p)))
        : noSloPaths;
    }

    return result;
  }, [selectedSubgraphs, subgraphOps, lcpFilter, lcpBoundaryPaths, phaseFilter, phaseBoundaryPaths, sloExceededFilter, sloExceededPaths, noSloFilter, noSloPaths, mock, treeNodes]);

  // Call count summary stats (uncached = actual network calls)
  const callSummary = useMemo(() => {
    if (mock?.[pctl]?.callSummary !== undefined) return mock[pctl].callSummary;
    if (subgraphOps.length === 0) return null;
    const requestIds = new Set(subgraphOps.map((o) => o.requestId));
    const numRequests = requestIds.size;
    const uncachedOps = subgraphOps.filter((o) => !o.cached).length;
    const cachedOps = subgraphOps.filter((o) => o.cached).length;
    return {
      callsPerReq: Math.round((uncachedOps / numRequests) * 10) / 10,
      dedupedPerReq: Math.round((cachedOps / numRequests) * 10) / 10,
    };
  }, [subgraphOps, pctl, mock]);

  // Derive boundary paths from computed tree nodes (works for both live and mock)
  const allBoundaryPaths = useMemo(
    () => treeNodes.filter((n) => n.type === "boundary").map((n) => n.boundaryPath),
    [treeNodes],
  );

  const expandAll = useCallback(() => setExpanded(new Set(allBoundaryPaths)), [allBoundaryPaths]);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  // Auto-expand all boundaries when tree changes
  const expandKey = allBoundaryPaths.join(",");
  if (expandKey !== lastExpandKey && expandKey.length > 0) {
    setExpanded(new Set(allBoundaryPaths));
    setLastExpandKey(expandKey);
  }

  // Filter visible nodes based on expanded state + subgraph filter
  const visibleNodes = useMemo(() => {
    const allBPaths = new Set(treeNodes.filter((n) => n.type === "boundary").map((n) => n.boundaryPath));

    // Check if all ancestor boundaries of a path are expanded
    function ancestorsExpanded(path: string): boolean {
      let candidate = getParentPath(path);
      while (candidate !== null) {
        if (allBPaths.has(candidate) && !expanded.has(candidate)) {
          return false;
        }
        candidate = getParentPath(candidate);
      }
      return true;
    }

    return treeNodes.filter((node) => {
      // Apply subgraph filter first
      if (filteredBoundaryPaths && !filteredBoundaryPaths.has(node.boundaryPath)) {
        return false;
      }
      if (node.type === "boundary") {
        // Root boundaries always visible; child boundaries visible if ancestors expanded
        return ancestorsExpanded(node.boundaryPath);
      }
      // Query/op nodes visible if their boundary AND all its ancestors are expanded
      return expanded.has(node.boundaryPath) && ancestorsExpanded(node.boundaryPath);
    });
  }, [treeNodes, expanded, filteredBoundaryPaths]);

  if (treeNodes.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        No metrics data. Generate load to populate the dashboard.
      </div>
    );
  }

  const pLabel = `p${pctl}`;

  return (
    <div className="overflow-x-auto">
      <TabDescription title="What does this measure?">
        <p>
          This tree maps directly to the <strong className="text-zinc-300">React Suspense boundaries</strong> in
          the page. Each boundary is an independent loading unit — it can fetch data and render without waiting
          for the rest of the page. Nested under each boundary you&apos;ll see the GraphQL query it runs, and
          under each query, the individual <strong className="text-zinc-300">subgraph operations</strong> (the
          backend services that supply the data).
        </p>
        <p>
          Use the latency column to compare actual response times against each service&apos;s
          <strong className="text-zinc-300"> SLO</strong> (service-level objective). Red means the service
          exceeded its SLO at this percentile. If no SLO is defined, the cell shows &quot;—&quot;.
        </p>
        <p>
          <strong className="text-zinc-300">Cache</strong> indicators show whether a subgraph call was
          deduplicated by React&apos;s request memoization (i.e. multiple components requested the same data
          and React served it from an in-flight or completed fetch). This is <em>not</em> a backend/Redis
          cache — it&apos;s React&apos;s built-in deduplication within a single render pass. Deduplicated
          operations have near-zero latency and don&apos;t count toward the service&apos;s performance budget.
        </p>
        <p>
          <strong className="text-zinc-300">Server</strong> rows ran during SSR (HTML streaming).
          <strong className="text-zinc-300"> Client</strong> rows ran after hydration in the browser. Client-side
          fetches add to time-to-interactive and compete for the main thread during initialization, which
          can increase contention and delay interactivity.
        </p>
      </TabDescription>
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 mb-2 text-xs">
        <span className="text-zinc-600 mr-1">Filter:</span>
        <button
          onClick={() => togglePhaseFilter("ssr")}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            phaseFilter === "ssr"
              ? "border-emerald-500 text-emerald-300 bg-emerald-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-emerald-400" />
          Server
        </button>
        <button
          onClick={() => togglePhaseFilter("csr")}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            phaseFilter === "csr"
              ? "border-violet-500 text-violet-300 bg-violet-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-violet-400" />
          Client
        </button>
        <span className="text-zinc-800 mx-0.5">|</span>
        <button
          onClick={toggleLcpFilter}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            lcpFilter
              ? "border-blue-500 text-blue-300 bg-blue-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-blue-400" />
          LCP Path
        </button>
        <span className="text-zinc-800 mx-0.5">|</span>
        <button
          onClick={toggleSloExceededFilter}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            sloExceededFilter
              ? "border-red-500 text-red-300 bg-red-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-400" />
          SLO Exceeded
        </button>
        <button
          onClick={toggleNoSloFilter}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            noSloFilter
              ? "border-amber-500 text-amber-300 bg-amber-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-amber-400" />
          No SLO
        </button>
        <span className="text-zinc-800 mx-0.5">|</span>
        <button
          onClick={() => setShowSubgraphFilters((prev) => !prev)}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            selectedSubgraphs.size > 0
              ? "border-zinc-500 text-zinc-200 bg-zinc-800"
              : showSubgraphFilters
                ? "border-zinc-600 text-zinc-300 bg-zinc-800/50"
                : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          Subgraphs {selectedSubgraphs.size > 0 && `(${selectedSubgraphs.size})`} {showSubgraphFilters ? "\u25BE" : "\u25B8"}
        </button>
        {showSubgraphFilters &&
          availableSubgraphs.map((name) => {
            const color = subgraphColorMap.get(name) ?? DEFAULT_SUBGRAPH_COLOR;
            const isActive = selectedSubgraphs.has(name);
            const hasFilter = selectedSubgraphs.size > 0;
            return (
              <button
                key={name}
                onClick={() => toggleSubgraphFilter(name)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
                  isActive
                    ? "border-zinc-500 text-zinc-200 bg-zinc-800"
                    : hasFilter
                      ? "border-transparent text-zinc-600 opacity-50 hover:opacity-80"
                      : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                {name.replace("-subgraph", "")}
              </button>
            );
          })}
        {(selectedSubgraphs.size > 0 || lcpFilter || phaseFilter || sloExceededFilter || noSloFilter) && (
          <button
            onClick={() => { clearSubgraphFilter(); setLcpFilter(false); setPhaseFilter(null); setSloExceededFilter(false); setNoSloFilter(false); }}
            className="text-zinc-500 hover:text-zinc-300 ml-2 underline"
          >
            Clear
          </button>
        )}
      </div>
      {/* Call count summary */}
      {callSummary && (
        <div className="flex gap-4 mb-2 text-xs text-zinc-500">
          <span>{callSummary.callsPerReq} subgraph calls/req</span>
          {callSummary.dedupedPerReq > 0 && (
            <>
              <span className="text-zinc-700">|</span>
              <span>{callSummary.dedupedPerReq} saved by dedup</span>
            </>
          )}
        </div>
      )}
      <div className="flex gap-2 mb-2 justify-end">
        <button
          onClick={expandAll}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800"
        >
          Collapse All
        </button>
      </div>
      <table className="w-full text-sm font-mono table-fixed" style={{ minWidth: "700px" }}>
        <thead>
          <tr className="text-zinc-500 text-xs border-b border-zinc-800">
            <th className="text-left py-2 px-2 font-normal" style={{ width: "30%" }}>
              Boundary / Query / Subgraph
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "9%" }}>
              Wall Start
              <br />
              <span className="text-zinc-600">{pLabel}</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "9%" }}>
              Fetch
              <br />
              <span className="text-zinc-600">{pLabel}</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "9%" }}>
              Render
              <br />
              <span className="text-zinc-600">{pLabel}</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "9%" }}>
              Blocked
              <br />
              <span className="text-zinc-600">{pLabel}</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "9%" }}>
              Total
              <br />
              <span className="text-zinc-600">{pLabel}</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "8%" }}>SLO</th>
            <th className="text-center py-2 px-2 font-normal" style={{ width: "7%" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleNodes.map((node) => {
            const isSubgraphOp = node.type === "subgraph-op";
            const hasSlo = isSubgraphOp && node.slo > 0;
            const noSlo = isSubgraphOp && !hasSlo && !node.cached;
            const sloRatio = hasSlo && !node.cached ? node.fetchPctl / node.slo : 0;
            const statusColor =
              !isSubgraphOp || node.cached
                ? "text-zinc-600"
                : noSlo
                  ? "text-amber-500"
                  : sloRatio > 1
                    ? "text-red-400"
                    : sloRatio > 0.8
                      ? "text-yellow-400"
                      : "text-green-400";
            const statusIcon =
              !isSubgraphOp
                ? ""
                : node.cached
                  ? "\u2014"
                  : noSlo
                    ? "?"
                    : sloRatio > 1
                      ? "!!!"
                      : sloRatio > 0.8
                        ? "!!"
                        : "OK";

            const blockedHighlight =
              node.blockedPctl > 0 && node.lcpCritical
                ? "text-amber-400 font-medium"
                : node.blockedPctl > 0
                  ? "text-yellow-500/70"
                  : "text-zinc-600";

            const isExpanded = node.type === "boundary" && expanded.has(node.boundaryPath);
            const isDimmedByFilter =
              selectedSubgraphs.size > 0 &&
              node.type === "subgraph-op" &&
              node.subgraphName != null &&
              !selectedSubgraphs.has(node.subgraphName);

            return (
              <tr
                key={node.path}
                className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${
                  node.lcpCritical ? "border-l-2 border-l-blue-500/50" : ""
                } ${isDimmedByFilter ? "opacity-30" : ""}`}
              >
                <td className="py-1.5 px-2">
                  <div
                    className="flex items-center"
                    style={{ paddingLeft: `${node.depth * 16}px` }}
                  >
                    {node.depth > 0 && (
                      <span className="text-zinc-700 mr-1.5 flex-shrink-0">
                        <TreeConnector />
                      </span>
                    )}
                    {node.type === "boundary" && node.hasChildren ? (
                      <button
                        onClick={() => toggleExpand(node.boundaryPath)}
                        className="text-zinc-500 hover:text-zinc-300 mr-1 flex-shrink-0 w-4 text-center"
                      >
                        {isExpanded ? "\u25BE" : "\u25B8"}
                      </button>
                    ) : node.type === "boundary" ? (
                      <span className="w-4 mr-1 flex-shrink-0" />
                    ) : null}
                    {node.type === "subgraph-op" ? (
                      <span className={`flex items-center gap-1.5 ${node.cached ? "opacity-50" : ""}`}>
                        {(node.subgraphName || node.subgraphColor) && (
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: (node.subgraphName && subgraphColorMap.get(node.subgraphName)) || node.subgraphColor || DEFAULT_SUBGRAPH_COLOR }}
                          />
                        )}
                        <span className="text-zinc-400">{node.name.replace("-subgraph", "")}</span>
                        {node.cached && (
                          <span className="text-xs text-cyan-600 font-medium">cached</span>
                        )}
                      </span>
                    ) : node.type === "query" ? (
                      <span className={`${node.cached ? "opacity-50" : ""}`}>
                        <span className="text-teal-500/80">query:</span>
                        <span className="text-teal-400">{node.name}</span>
                        {node.cached && (
                          <span className="text-xs text-cyan-600 font-medium ml-1.5">cached</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-zinc-200 font-medium">
                        {node.name}
                      </span>
                    )}
                    {node.lcpCritical && (
                      <span className="ml-1.5 text-blue-400 text-xs" title="LCP Critical">
                        LCP
                      </span>
                    )}
                    {node.type === "boundary" && node.phase === "csr" && (
                      <span className="ml-1.5 text-violet-400 text-xs" title="Client Component">
                        CSR
                      </span>
                    )}
                  </div>
                </td>
                <td className="text-right py-1.5 px-2 text-zinc-400">
                  {node.type === "boundary" ? `${node.wallStartPctl}ms` : ""}
                </td>
                <td className={`text-right py-1.5 px-2 ${node.cached ? "text-zinc-700" : "text-zinc-300"}`}>
                  {node.cached ? "0ms" : `${node.fetchPctl}ms`}
                </td>
                <td className="text-right py-1.5 px-2 text-zinc-300">
                  {node.type === "boundary" ? `${node.renderCostPctl}ms` : ""}
                </td>
                <td className={`text-right py-1.5 px-2 ${blockedHighlight}`}>
                  {node.type === "boundary"
                    ? node.blockedPctl > 0
                      ? `${node.blockedPctl}ms`
                      : "\u2014"
                    : ""}
                </td>
                <td className={`text-right py-1.5 px-2 ${node.cached ? "text-zinc-700" : "text-zinc-300"}`}>
                  {node.type === "boundary"
                    ? `${node.totalPctl}ms`
                    : node.cached
                      ? "0ms"
                      : `${node.fetchPctl}ms`}
                </td>
                <td className={`text-right py-1.5 px-2 ${noSlo ? "text-amber-500/70 italic" : "text-zinc-500"}`}>
                  {isSubgraphOp && !node.cached
                    ? hasSlo
                      ? `${node.slo}ms`
                      : "none"
                    : ""}
                </td>
                <td className={`text-center py-1.5 px-2 ${statusColor}`}>
                  {statusIcon}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TreeConnector() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="text-zinc-700"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <line x1="4" y1="0" x2="4" y2="8" />
      <line x1="4" y1="8" x2="14" y2="8" />
    </svg>
  );
}
