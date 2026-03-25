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
import { Tooltip } from "./Tooltip";

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
  noAwait?: boolean;
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
  const [expandedQueries, setExpandedQueries] = useState<Set<string>>(new Set());
  const [lastExpandKey, setLastExpandKey] = useState("");

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleQueryExpand = useCallback((path: string) => {
    setExpandedQueries((prev) => {
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
        // Use actual recorded duration — for memoized queries still in-flight,
        // this reflects the remaining wait time (matching the boundary row)
        const queryDurationPctl = percentile(durations, pctl);

        nodes.push({
          name: item.queryName!,
          path: item.path,
          depth,
          type: "query",
          boundaryPath: item.boundaryPath,
          wallStartPctl: 0,
          fetchPctl: queryDurationPctl,
          renderCostPctl: 0,
          blockedPctl: 0,
          totalPctl: queryDurationPctl,
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

        // Use actual recorded duration — matches boundary row for memoized ops
        const durationPctl = percentile(durations, pctl);
        nodes.push({
          name: sgName || item.opName!,
          path: item.path,
          depth,
          type: "subgraph-op",
          boundaryPath: item.boundaryPath,
          wallStartPctl: 0,
          fetchPctl: durationPctl,
          renderCostPctl: 0,
          blockedPctl: 0,
          totalPctl: durationPctl,
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

  // LCP filter toggle
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

  // Focus filter — collapses everything outside the focused boundary hierarchy
  const [focusPath, setFocusPath] = useState<string | null>(null);

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

  // Compute the set of "active" boundary paths for collapse-based filtering.
  // Instead of hiding non-matching nodes, we collapse queries/boundaries outside the active path.
  const activeBoundaryPaths = useMemo(() => {
    const hasSubgraphFilter = selectedSubgraphs.size > 0;
    if (!lcpFilter && !hasSubgraphFilter && !focusPath) return null;

    let result: Set<string> | null = null;

    if (lcpFilter) {
      result = lcpBoundaryPaths;
    }

    if (hasSubgraphFilter) {
      const directMatches = new Set<string>();
      for (const n of treeNodes) {
        if (n.type !== "subgraph-op") continue;
        if (!(n.subgraphName && selectedSubgraphs.has(n.subgraphName))) continue;
        directMatches.add(n.boundaryPath);
      }
      // Add ancestors
      const withAncestors = new Set(directMatches);
      for (const p of directMatches) {
        let candidate = getParentPath(p);
        while (candidate !== null) {
          withAncestors.add(candidate);
          candidate = getParentPath(candidate);
        }
      }
      result = result
        ? new Set([...result].filter((p) => withAncestors.has(p)))
        : withAncestors;
    }

    if (focusPath) {
      const focusSet = new Set<string>();
      focusSet.add(focusPath);
      // Add ancestors
      let candidate = getParentPath(focusPath);
      while (candidate !== null) {
        focusSet.add(candidate);
        candidate = getParentPath(candidate);
      }
      // Add descendants
      for (const n of treeNodes) {
        if (n.type === "boundary" && n.boundaryPath.startsWith(focusPath + ".")) {
          focusSet.add(n.boundaryPath);
        }
      }
      result = result
        ? new Set([...result].filter((p) => focusSet.has(p)))
        : focusSet;
    }

    return result;
  }, [selectedSubgraphs, lcpFilter, lcpBoundaryPaths, focusPath, treeNodes]);

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

  // Filter chip counts
  const lcpCount = useMemo(() => {
    return treeNodes.filter((n) => n.type === "boundary" && n.lcpCritical).length;
  }, [treeNodes]);

  // Derive boundary paths from computed tree nodes (works for both live and mock)
  const allBoundaryPaths = useMemo(
    () => treeNodes.filter((n) => n.type === "boundary").map((n) => n.boundaryPath),
    [treeNodes],
  );

  // Derive query paths for separate collapse control
  const allQueryPaths = useMemo(
    () => treeNodes.filter((n) => n.type === "query").map((n) => n.path),
    [treeNodes],
  );

  // Determine which queries have subgraph-op children
  const queryHasChildren = useMemo(() => {
    const set = new Set<string>();
    for (const n of treeNodes) {
      if (n.type === "subgraph-op") {
        // Find the parent query path for this op
        const queryNode = treeNodes.find(
          (q) => q.type === "query" && q.boundaryPath === n.boundaryPath && n.path.startsWith(q.path + "."),
        );
        if (queryNode) set.add(queryNode.path);
      }
    }
    return set;
  }, [treeNodes]);

  const expandQueries = useCallback(() => {
    setExpandedQueries(new Set(allQueryPaths));
  }, [allQueryPaths]);
  const collapseQueries = useCallback(() => setExpandedQueries(new Set()), []);

  // Auto-expand all boundaries (but keep queries collapsed) when tree changes
  const expandKey = allBoundaryPaths.join(",");
  if (expandKey !== lastExpandKey && expandKey.length > 0) {
    setExpanded(new Set(allBoundaryPaths));
    setExpandedQueries(new Set());
    setLastExpandKey(expandKey);
  }

  // When activeBoundaryPaths changes, collapse components outside the active path
  // and expand those in the path. Non-active boundaries are collapsed + dimmed.
  const [lastActiveKey, setLastActiveKey] = useState<string>("");
  const activeKey = activeBoundaryPaths ? [...activeBoundaryPaths].sort().join(",") : "";
  if (activeKey !== lastActiveKey) {
    setLastActiveKey(activeKey);
    if (activeBoundaryPaths) {
      // Only expand boundaries in the active path
      setExpanded(new Set([...allBoundaryPaths].filter((p) => activeBoundaryPaths.has(p))));
      // Only expand queries under active boundaries
      const activeQueries = new Set<string>();
      for (const n of treeNodes) {
        if (n.type === "query" && activeBoundaryPaths.has(n.boundaryPath)) {
          activeQueries.add(n.path);
        }
      }
      setExpandedQueries(activeQueries);
    } else {
      // Filters cleared — expand all boundaries, collapse all queries
      setExpanded(new Set(allBoundaryPaths));
      setExpandedQueries(new Set());
    }
  }

  // Filter visible nodes based on expanded state (all nodes remain in tree, just collapsed)
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
      if (node.type === "boundary") {
        return ancestorsExpanded(node.boundaryPath);
      }
      if (node.type === "subgraph-op") {
        const parentQuery = treeNodes.find(
          (q) => q.type === "query" && q.boundaryPath === node.boundaryPath && node.path.startsWith(q.path + "."),
        );
        if (parentQuery && !expandedQueries.has(parentQuery.path)) return false;
      }
      return expanded.has(node.boundaryPath) && ancestorsExpanded(node.boundaryPath);
    });
  }, [treeNodes, expanded, expandedQueries]);

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
      <TabDescription title="What does this measure?" storageKey="tree">
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
          <strong className="text-zinc-300">Memoized</strong> indicators show whether a subgraph call was
          deduplicated by React&apos;s request memoization (i.e. multiple components requested the same data
          and React served it from an in-flight or completed fetch). This is <em>not</em> a backend/Redis
          cache — it&apos;s React&apos;s built-in deduplication within a single render pass. If the original
          query is still in-flight when a memoized consumer renders, the remaining wait time is shown faded.
        </p>
        <p>
          <strong className="text-zinc-300">Prefetch</strong> queries are fired early by a parent boundary
          with <code>await: false</code> — the boundary doesn&apos;t suspend, but the request starts in the
          background. Descendant boundaries that need the same data benefit from the head start.
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
          onClick={toggleLcpFilter}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            lcpFilter
              ? "border-blue-500 text-blue-300 bg-blue-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-blue-400" />
          LCP Path ({lcpCount})
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
        {(selectedSubgraphs.size > 0 || lcpFilter || focusPath) && (
          <button
            onClick={() => { clearSubgraphFilter(); setLcpFilter(false); setFocusPath(null); }}
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
              <span>{callSummary.dedupedPerReq} memoized</span>
            </>
          )}
        </div>
      )}
      <div className="flex gap-2 mb-2 justify-end">
        <button
          onClick={expandQueries}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800"
        >
          Expand Queries
        </button>
        <button
          onClick={collapseQueries}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800"
        >
          Collapse Queries
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
          {visibleNodes.length === 0 && (
            <tr>
              <td colSpan={8} className="text-center py-8 text-zinc-500">
                <p>No results match the current filters.</p>
                <button
                  onClick={() => { clearSubgraphFilter(); setLcpFilter(false); setFocusPath(null); }}
                  className="mt-2 text-blue-400 hover:text-blue-300 underline text-sm"
                >
                  Clear all filters
                </button>
              </td>
            </tr>
          )}
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
            const isQueryExpanded = node.type === "query" && expandedQueries.has(node.path) && queryHasChildren.has(node.path);
            const isDimmedByFilter = activeBoundaryPaths !== null && !activeBoundaryPaths.has(node.boundaryPath);

            const isClickExpandable =
              (node.type === "boundary" && node.hasChildren) ||
              (node.type === "query" && queryHasChildren.has(node.path));
            const handleRowClick = isClickExpandable
              ? () => {
                  if (node.type === "boundary") toggleExpand(node.boundaryPath);
                  else if (node.type === "query") toggleQueryExpand(node.path);
                }
              : undefined;

            const isFocused = focusPath === node.boundaryPath;

            return (
              <tr
                key={node.path}
                className={`group border-b border-zinc-800/50 hover:bg-zinc-800/30 ${
                  node.lcpCritical ? "border-l-2 border-l-blue-500/50" : ""
                } ${isDimmedByFilter ? "opacity-50" : ""} ${isClickExpandable ? "cursor-pointer" : ""}`}
                onClick={handleRowClick}
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
                        onClick={(e) => { e.stopPropagation(); toggleExpand(node.boundaryPath); }}
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
                          <span className="text-xs text-cyan-600 font-medium">memoized</span>
                        )}
                      </span>
                    ) : node.type === "query" ? (
                      <span className={`flex items-center ${node.cached || node.noAwait ? "opacity-50" : ""}`}>
                        {queryHasChildren.has(node.path) ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleQueryExpand(node.path); }}
                            className="text-zinc-500 hover:text-zinc-300 mr-1 flex-shrink-0 w-4 text-center"
                          >
                            {isQueryExpanded ? "\u25BE" : "\u25B8"}
                          </button>
                        ) : (
                          <span className="w-4 mr-1 flex-shrink-0" />
                        )}
                        <span className="text-teal-500/80">query:</span>
                        <span className="text-teal-400">{node.name}</span>
                        {node.noAwait && (
                          <span className="text-xs text-orange-500 font-medium ml-1.5">prefetch</span>
                        )}
                        {node.cached && !node.noAwait && (
                          <span className="text-xs text-cyan-600 font-medium ml-1.5">memoized</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-zinc-200 font-medium">
                        {node.name}
                      </span>
                    )}
                    {node.lcpCritical && (
                      <Tooltip content="LCP Critical" className="inline-flex ml-1.5">
                        <span className="text-blue-400 text-xs">
                          LCP
                        </span>
                      </Tooltip>
                    )}
                    {node.type === "boundary" && node.phase === "csr" && (
                      <Tooltip content="Client Component" className="inline-flex ml-1.5">
                        <span className="text-violet-400 text-xs">
                          CSR
                        </span>
                      </Tooltip>
                    )}
                    {node.type === "boundary" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusPath(isFocused ? null : node.boundaryPath);
                        }}
                        className={`ml-auto text-xs px-1.5 py-0.5 rounded transition-all flex-shrink-0 ${
                          isFocused
                            ? "text-blue-400 bg-blue-500/10"
                            : "text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        {isFocused ? "Focused" : "Focus"}
                      </button>
                    )}
                  </div>
                </td>
                <td className="text-right py-1.5 px-2 text-zinc-400">
                  {node.type === "boundary" ? `${node.wallStartPctl}ms` : ""}
                </td>
                <td className={`text-right py-1.5 px-2 ${node.cached || node.noAwait ? "text-zinc-700" : "text-zinc-300"}`}>
                  {node.noAwait
                    ? <span className="opacity-50">{node.fetchPctl}ms</span>
                    : node.cached
                      ? <span className="opacity-60">{node.fetchPctl}ms</span>
                      : `${node.fetchPctl}ms`}
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
                <td className={`text-right py-1.5 px-2 ${node.cached || node.noAwait ? "text-zinc-700" : "text-zinc-300"}`}>
                  {node.type === "boundary"
                    ? `${node.totalPctl}ms`
                    : node.noAwait
                      ? <span className="opacity-50">{node.fetchPctl}ms</span>
                      : node.cached
                        ? <span className="opacity-60">{node.fetchPctl}ms</span>
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
