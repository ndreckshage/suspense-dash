"use client";

import { useMemo, useState, useCallback } from "react";
import type {
  BoundaryMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "@/lib/metrics-store";
import {
  GQL_QUERIES,
  SUBGRAPH_OPERATIONS,
  SUBGRAPHS,
} from "@/lib/gql-federation";
import { percentile, median as medianUtil } from "@/lib/percentile";

interface Props {
  boundaries: BoundaryMetric[];
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  pctl: number;
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
 *      "csr.Cart" → "csr"
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
  for (const b of boundaries) {
    const list = wallStartsByPath.get(b.boundary_path) ?? [];
    list.push(b.wall_start_ms);
    wallStartsByPath.set(b.boundary_path, list);
    if (b.is_lcp_critical) lcpByPath.set(b.boundary_path, true);
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

  // 4. Collect unique subgraph ops per (boundary, query)
  const opsByBoundaryQuery = new Map<string, Map<string, string>>();
  for (const op of subgraphOps) {
    const key = `${op.boundary_path}:${op.queryName}`;
    const opsMap = opsByBoundaryQuery.get(key) ?? new Map();
    opsMap.set(op.operationName, op.subgraphName);
    opsByBoundaryQuery.set(key, opsMap);
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
          });

          const opsKey = `${boundaryPath}:${queryName}`;
          const ops = opsByBoundaryQuery.get(opsKey);
          if (ops) {
            let opIdx = 0;
            for (const [opName, subgraphName] of ops) {
              items.push({
                path: `${queryPath}.op${opIdx > 0 ? opIdx : ""}`,
                name: opName,
                type: "subgraph-op",
                boundaryPath,
                queryName,
                opName,
                subgraphName,
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

// Boundary-level SLOs
const BOUNDARY_SLOS: Record<string, number> = {
  Layout: 75,
  "Layout.Nav": 250,
  "Layout.Content": 150,
  "Layout.Content.Breadcrumbs": 150,
  "Layout.Content.Main.Hero": 75,
  "Layout.Content.Main.Thumbnails": 150,
  "Layout.Content.Main.Title": 125,
  "Layout.Content.Main.Pricing": 750,
  "Layout.Content.Main.Bullets": 100,
  "Layout.Content.Main.Options": 100,
  "Layout.Content.Main.AddToCart": 25,
  "Layout.Content.Carousels": 500,
  "Layout.Content.Reviews": 690,
  "Layout.Footer": 125,
};

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
}

function getDepth(item: TreeItem, depthMap: Map<string, number>): number {
  if (item.type === "boundary") {
    return depthMap.get(item.boundaryPath) ?? 0;
  }
  // Queries and ops indent one/two levels deeper than their boundary
  const boundaryDepth = depthMap.get(item.boundaryPath) ?? 0;
  return item.type === "query" ? boundaryDepth + 1 : boundaryDepth + 2;
}

export function BoundaryTreeTable({ boundaries, queries, subgraphOps, pctl }: Props) {
  // Build tree structure dynamically from recorded metrics
  const treeStructure = useMemo(
    () => buildTreeFromMetrics(boundaries, queries, subgraphOps),
    [boundaries, queries, subgraphOps],
  );

  const allBoundaryPaths = useMemo(
    () => treeStructure.filter((t) => t.type === "boundary").map((t) => t.boundaryPath),
    [treeStructure],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand all boundaries when tree structure changes
  useMemo(() => {
    setExpanded(new Set(allBoundaryPaths));
  }, [allBoundaryPaths]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setExpanded(new Set(allBoundaryPaths)), [allBoundaryPaths]);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  // Subgraph filter — empty means "show all"
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

  // Compute which boundaries match the subgraph filter
  const filteredBoundaryPaths = useMemo(() => {
    if (selectedSubgraphs.size === 0) return null; // no filter
    const matching = new Set<string>();
    for (const op of subgraphOps) {
      if (selectedSubgraphs.has(op.subgraphName)) {
        matching.add(op.boundary_path);
      }
    }
    return matching;
  }, [selectedSubgraphs, subgraphOps]);

  // Call count summary stats (uncached = actual network calls)
  const callSummary = useMemo(() => {
    if (subgraphOps.length === 0) return null;
    const requestIds = new Set(subgraphOps.map((o) => o.requestId));
    const numRequests = requestIds.size;
    const uncachedOps = subgraphOps.filter((o) => !o.cached).length;
    const cachedOps = subgraphOps.filter((o) => o.cached).length;
    return {
      callsPerReq: Math.round((uncachedOps / numRequests) * 10) / 10,
      dedupedPerReq: Math.round((cachedOps / numRequests) * 10) / 10,
    };
  }, [subgraphOps]);

  const treeNodes = useMemo(() => {
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

    const opByKey = new Map<string, SubgraphOperationMetric[]>();
    for (const op of subgraphOps) {
      const key = `${op.boundary_path}:${op.queryName}:${op.operationName}`;
      const list = opByKey.get(key) ?? [];
      list.push(op);
      opByKey.set(key, list);
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
          slo: BOUNDARY_SLOS[item.boundaryPath] ?? 500,
          lcpCritical: item.lcpCritical ?? false,
          cached: false,
          hasChildren: boundaryHasChildren.has(item.boundaryPath),
        });
      } else if (item.type === "query") {
        const key = `${item.boundaryPath}:${item.queryName}`;
        const metrics = queryByKey.get(key) ?? [];
        const durations = metrics.map((m) => m.duration_ms);
        const querySlo = GQL_QUERIES[item.queryName!]?.sloMs ?? 500;
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
          slo: querySlo,
          lcpCritical: false,
          cached: isCached,
          hasChildren: false,
        });
      } else {
        const key = `${item.boundaryPath}:${item.queryName}:${item.opName}`;
        const metrics = opByKey.get(key) ?? [];
        const durations = metrics.map((m) => m.duration_ms);
        const opSlo = SUBGRAPH_OPERATIONS[item.opName!]?.sloMs ?? 100;
        const isCached = metrics.length > 0 && metrics.every((m) => m.cached);
        const subgraphColor = item.subgraphName
          ? SUBGRAPHS[item.subgraphName as keyof typeof SUBGRAPHS]?.color
          : undefined;

        nodes.push({
          name: item.opName!,
          path: item.path,
          depth,
          type: "subgraph-op",
          boundaryPath: item.boundaryPath,
          wallStartPctl: 0,
          fetchPctl: isCached ? 0 : percentile(durations, pctl),
          renderCostPctl: 0,
          blockedPctl: 0,
          totalPctl: isCached ? 0 : percentile(durations, pctl),
          slo: opSlo,
          lcpCritical: false,
          cached: isCached,
          subgraphName: item.subgraphName,
          subgraphColor,
          hasChildren: false,
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
  }, [treeStructure, boundaries, queries, subgraphOps, pctl]);

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
      {/* Subgraph filter chips */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 mb-2 text-xs">
        <span className="text-zinc-600 mr-1">Filter:</span>
        {Object.entries(SUBGRAPHS).map(([name, { color }]) => {
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
        {selectedSubgraphs.size > 0 && (
          <button
            onClick={clearSubgraphFilter}
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
              Boundary / Query / Subgraph Op
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
            const metricValue = node.type === "boundary" ? node.totalPctl : node.fetchPctl;
            const sloRatio = node.cached ? 0 : metricValue / node.slo;
            const statusColor =
              node.cached
                ? "text-zinc-600"
                : sloRatio > 1
                  ? "text-red-400"
                  : sloRatio > 0.8
                    ? "text-yellow-400"
                    : "text-green-400";
            const statusIcon = node.cached
              ? "\u2014"
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
                        {node.subgraphColor && (
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: node.subgraphColor }}
                          />
                        )}
                        <span className="text-zinc-500">{node.name}</span>
                        {node.subgraphName && (
                          <span className="text-zinc-700 text-xs">
                            ({node.subgraphName.replace("-subgraph", "")})
                          </span>
                        )}
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
                <td className="text-right py-1.5 px-2 text-zinc-500">
                  {node.cached ? "" : `${node.slo}ms`}
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
