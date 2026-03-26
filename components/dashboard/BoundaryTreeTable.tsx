"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import type { DashboardTreeData } from "@/lib/dashboard-types";
import { buildSubgraphColorMap, DEFAULT_SUBGRAPH_COLOR } from "@/lib/subgraph-colors";
import { TabDescription } from "./TabDescription";
import { Tooltip } from "./Tooltip";

interface Props {
  pctl: number;
  /** Pre-computed data keyed by percentile (from YAML or live conversion) */
  mock: Record<number, DashboardTreeData>;
}

function getParentPath(path: string): string | null {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? null : path.substring(0, idx);
}

interface TreeNode {
  name: string;
  path: string;
  depth: number;
  type: "boundary" | "query" | "subgraph-op";
  boundaryPath: string;
  queryLatencyPctl: number;
  subgraphLatencyPctl: number;
  querySlo: number;
  subgraphSlo: number;
  weight: number;
  lcpCritical: boolean;
  memoized: boolean;
  prefetch: boolean;
  subgraphName?: string;
  subgraphColor?: string;
  hasChildren: boolean;
  phase?: "ssr" | "csr";
  wallStartPctl: number;
  renderCostPctl: number;
}

export function BoundaryTreeTable({ pctl, mock }: Props) {

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

  const treeNodes = useMemo(
    () => mock?.[pctl]?.nodes ?? [],
    [pctl, mock],
  );

  // LCP filter toggle — clears subgraph/focus when activated
  const [lcpFilter, setLcpFilter] = useState(false);
  const toggleLcpFilter = useCallback(() => {
    setLcpFilter((prev) => {
      if (!prev) {
        // Activating LCP — clear other filters
        setSelectedSubgraphs(new Set());
        setShowSubgraphFilters(false);
        setFocusPath(null);
      }
      return !prev;
    });
  }, []);

  // Subgraph filter — clears LCP/focus when activated
  const [showSubgraphFilters, setShowSubgraphFilters] = useState(false);
  const [selectedSubgraphs, setSelectedSubgraphs] = useState<Set<string>>(new Set());
  const toggleSubgraphFilter = useCallback((name: string) => {
    setLcpFilter(false);
    setFocusPath(null);
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

  // Focus filter — clears LCP/subgraph when activated
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const applyFocus = useCallback((path: string | null) => {
    if (path) {
      setLcpFilter(false);
      setSelectedSubgraphs(new Set());
    }
    setFocusPath(path);
  }, []);

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

  // Compute the set of "active" boundary paths — only one filter type active at a time
  const activeBoundaryPaths = useMemo(() => {
    if (lcpFilter) return lcpBoundaryPaths;

    if (selectedSubgraphs.size > 0) {
      const directMatches = new Set<string>();
      for (const n of treeNodes) {
        if (n.type !== "subgraph-op") continue;
        if (!(n.subgraphName && selectedSubgraphs.has(n.subgraphName))) continue;
        directMatches.add(n.boundaryPath);
      }
      const withAncestors = new Set(directMatches);
      for (const p of directMatches) {
        let candidate = getParentPath(p);
        while (candidate !== null) {
          withAncestors.add(candidate);
          candidate = getParentPath(candidate);
        }
      }
      return withAncestors;
    }

    if (focusPath) {
      const focusSet = new Set<string>();
      focusSet.add(focusPath);
      let candidate = getParentPath(focusPath);
      while (candidate !== null) {
        focusSet.add(candidate);
        candidate = getParentPath(candidate);
      }
      for (const n of treeNodes) {
        if (n.type === "boundary" && n.boundaryPath.startsWith(focusPath + ".")) {
          focusSet.add(n.boundaryPath);
        }
      }
      return focusSet;
    }

    return null;
  }, [selectedSubgraphs, lcpFilter, lcpBoundaryPaths, focusPath, treeNodes]);

  // Call count summary stats (uncached = actual network calls)
  const callSummary = useMemo(
    () => mock?.[pctl]?.callSummary ?? null,
    [pctl, mock],
  );

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
        const queryNode = treeNodes.find(
          (q) => q.type === "query" && q.boundaryPath === n.boundaryPath && n.path.startsWith(q.path + "."),
        );
        if (queryNode) set.add(queryNode.path);
      }
    }
    return set;
  }, [treeNodes]);

  // Aggregate SLO + status from child subgraph-ops for each query
  const querySloSummary = useMemo(() => {
    const map = new Map<string, { sloLabel: string; sloClass: string; statusIcon: string; statusColor: string }>();
    // Group uncached subgraph-ops by parent query path
    const opsByQuery = new Map<string, typeof treeNodes>();
    for (const n of treeNodes) {
      if (n.type !== "subgraph-op" || n.memoized) continue;
      const queryNode = treeNodes.find(
        (q) => q.type === "query" && q.boundaryPath === n.boundaryPath && n.path.startsWith(q.path + "."),
      );
      if (!queryNode) continue;
      const list = opsByQuery.get(queryNode.path) ?? [];
      list.push(n);
      opsByQuery.set(queryNode.path, list);
    }
    for (const [qPath, ops] of opsByQuery) {
      let maxSlo = 0;
      let hasSome = false;
      let hasMissing = false;
      let worstStatus: "ok" | "warn" | "exceeded" | "none" = "none";
      for (const op of ops) {
        if (op.subgraphSlo > 0) {
          hasSome = true;
          if (op.subgraphSlo > maxSlo) maxSlo = op.subgraphSlo;
          const ratio = op.subgraphLatencyPctl / op.subgraphSlo;
          if (ratio > 1 && worstStatus !== "exceeded") worstStatus = "exceeded";
          else if (ratio > 0.8 && worstStatus !== "exceeded") worstStatus = "warn";
          else if (worstStatus === "none") worstStatus = "ok";
        } else {
          hasMissing = true;
        }
      }
      // SLO label: highest value, with "mixed" if some are missing
      const sloLabel = hasSome
        ? hasMissing ? `${maxSlo}ms*` : `${maxSlo}ms`
        : "none";
      const sloClass = !hasSome
        ? "text-amber-500/70 italic"
        : hasMissing
          ? "text-amber-500/70"
          : "text-zinc-500";
      // Status: worst across children, but "?" if any are missing
      let statusIcon: string;
      let statusColor: string;
      if (hasMissing && !hasSome) {
        statusIcon = "?";
        statusColor = "text-amber-500";
      } else if (worstStatus === "exceeded") {
        statusIcon = "!!!";
        statusColor = "text-red-400";
      } else if (worstStatus === "warn") {
        statusIcon = "!!";
        statusColor = "text-yellow-400";
      } else if (hasMissing) {
        statusIcon = "?";
        statusColor = "text-amber-500";
      } else {
        statusIcon = "OK";
        statusColor = "text-green-400";
      }
      map.set(qPath, { sloLabel, sloClass, statusIcon, statusColor });
    }
    return map;
  }, [treeNodes]);

  const allQueriesExpanded = allQueryPaths.length > 0 && allQueryPaths.every((p) => expandedQueries.has(p));
  const allQueriesCollapsed = expandedQueries.size === 0;
  const expandAllQueries = useCallback(() => {
    setExpandedQueries(new Set(allQueryPaths));
    userToggledQueries.current = true;
  }, [allQueryPaths]);
  const collapseAllQueries = useCallback(() => {
    setExpandedQueries(new Set());
    userToggledQueries.current = true;
  }, []);

  // Track whether user has manually toggled queries during the current filter session
  const userToggledQueries = useRef(false);

  // Auto-expand all boundaries (but keep queries collapsed) when tree changes
  const expandKey = allBoundaryPaths.join(",");
  if (expandKey !== lastExpandKey && expandKey.length > 0) {
    setExpanded(new Set(allBoundaryPaths));
    setExpandedQueries(new Set());
    setLastExpandKey(expandKey);
  }

  // Auto-expand queries on first filter activation; collapse when all filters cleared
  const hasActiveFilter = activeBoundaryPaths !== null;
  const prevHadFilter = useRef(false);
  if (hasActiveFilter !== prevHadFilter.current) {
    if (hasActiveFilter && !prevHadFilter.current) {
      // First filter applied — expand queries (only if user hasn't manually toggled)
      if (!userToggledQueries.current) {
        setExpandedQueries(new Set(allQueryPaths));
      }
    } else if (!hasActiveFilter && prevHadFilter.current) {
      // All filters cleared — collapse queries and reset manual toggle tracking
      setExpandedQueries(new Set());
      userToggledQueries.current = false;
    }
    prevHadFilter.current = hasActiveFilter;
  }

  // Filter visible nodes based on expanded state + active filter (hides non-matching nodes)
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
      // Hide nodes outside the active filter (LCP, subgraph, or focus)
      if (activeBoundaryPaths && !activeBoundaryPaths.has(node.boundaryPath)) {
        return false;
      }
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
  }, [treeNodes, expanded, expandedQueries, activeBoundaryPaths]);

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
          This tree maps directly to the <strong className="text-zinc-300">React Suspense boundaries</strong>{" "}in
          the page. Each boundary is an independent loading unit — it can fetch data and render without waiting
          for the rest of the page. Nested under each boundary you&apos;ll see the GraphQL query it runs, and
          under each query, the individual <strong className="text-zinc-300">subgraph operations</strong>{" "}(the
          backend services that supply the data).
        </p>
        <p>
          Use the latency column to compare actual response times against each service&apos;s
          <strong className="text-zinc-300">SLO</strong>{" "}(service-level objective). Red means the service
          exceeded its SLO at this percentile. If no SLO is defined, the cell shows &quot;—&quot;.
        </p>
        <p>
          <strong className="text-zinc-300">Memoized</strong>{" "}indicators show whether a subgraph call was
          deduplicated by React&apos;s request memoization (i.e. multiple components requested the same data
          and React served it from an in-flight or completed fetch). This is <em>not</em>{" "}a backend/Redis
          cache — it&apos;s React&apos;s built-in deduplication within a single render pass. If the original
          query is still in-flight when a memoized consumer renders, the remaining wait time is shown faded.
        </p>
        <p>
          <strong className="text-zinc-300">Prefetch</strong>{" "}queries are fired early by a parent boundary
          with <code>await: false</code> — the boundary doesn&apos;t suspend, but the request starts in the
          background. Descendant boundaries that need the same data benefit from the head start.
        </p>
        <p>
          <strong className="text-zinc-300">Server</strong>{" "}rows ran during SSR (HTML streaming).{" "}
          <strong className="text-zinc-300">Client</strong>{" "}rows ran after hydration in the browser. Client-side
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
          LCP Path
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
        {!allQueriesExpanded && (
          <button
            onClick={expandAllQueries}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800"
          >
            Expand Queries
          </button>
        )}
        {!allQueriesCollapsed && (
          <button
            onClick={collapseAllQueries}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800"
          >
            Collapse Queries
          </button>
        )}
      </div>
      <table className="w-full text-sm font-mono table-fixed" style={{ minWidth: "700px" }}>
        <thead>
          <tr className="text-zinc-500 text-xs border-b border-zinc-800">
            <th className="text-left py-2 px-2 font-normal" style={{ width: "35%" }}>
              <Tooltip content="React Suspense boundary hierarchy: boundaries → GraphQL queries → subgraph operations">
                <span>Boundary / Query / Subgraph</span>
              </Tooltip>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "13%" }}>
              <Tooltip content="End-to-end query latency at this percentile. For subgraph ops, shows the weighted portion (weight × query latency).">
                <span>Query Latency<br /><span className="text-zinc-600">{pLabel}</span></span>
              </Tooltip>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "13%" }}>
              <Tooltip content="Service-wide latency for this subgraph at the selected percentile — independent of any specific query.">
                <span>Subgraph Latency<br /><span className="text-zinc-600">{pLabel}</span></span>
              </Tooltip>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "12%" }}>
              <Tooltip content="Service-level objective. Query rows show the query SLO; subgraph rows show the subgraph service SLO.">
                <span>SLO</span>
              </Tooltip>
            </th>
            <th className="text-center py-2 px-2 font-normal" style={{ width: "10%" }}>
              <Tooltip content="SLO status: OK = within budget, !! = warning (>80%), !!! = exceeded, ? = no SLO defined.">
                <span>Status</span>
              </Tooltip>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleNodes.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center py-8 text-zinc-500">
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
            const isQuery = node.type === "query";

            // SLO/status for subgraph-op rows
            const sgHasSlo = isSubgraphOp && node.subgraphSlo > 0;
            const sgNoSlo = isSubgraphOp && !sgHasSlo && !node.memoized;
            const sgSloRatio = sgHasSlo && !node.memoized ? node.subgraphLatencyPctl / node.subgraphSlo : 0;

            // SLO/status for query rows
            const qHasSlo = isQuery && node.querySlo > 0;
            const qNoSlo = isQuery && !qHasSlo && !node.memoized;
            const qSloRatio = qHasSlo && !node.memoized ? node.queryLatencyPctl / node.querySlo : 0;

            const statusColor =
              isSubgraphOp
                ? (node.memoized ? "text-zinc-600" : sgNoSlo ? "text-amber-500" : sgSloRatio > 1 ? "text-red-400" : sgSloRatio > 0.8 ? "text-yellow-400" : "text-green-400")
                : isQuery
                  ? (node.memoized ? "text-zinc-600" : qNoSlo ? "text-amber-500" : qSloRatio > 1 ? "text-red-400" : qSloRatio > 0.8 ? "text-yellow-400" : "text-green-400")
                  : "text-zinc-600";
            const statusIcon =
              isSubgraphOp
                ? (node.memoized ? "\u2014" : sgNoSlo ? "?" : sgSloRatio > 1 ? "!!!" : sgSloRatio > 0.8 ? "!!" : "OK")
                : isQuery
                  ? (node.memoized ? "\u2014" : qNoSlo ? "?" : qSloRatio > 1 ? "!!!" : qSloRatio > 0.8 ? "!!" : "OK")
                  : "";

            const isExpanded = node.type === "boundary" && expanded.has(node.boundaryPath);
            const isQueryExpanded = node.type === "query" && expandedQueries.has(node.path) && queryHasChildren.has(node.path);
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
                } ${isClickExpandable ? "cursor-pointer" : ""}`}
                onClick={handleRowClick}
              >
                <td className="py-1.5 px-2 overflow-hidden">
                  <div
                    className="flex items-center min-w-0"
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
                      <span className={`flex items-center gap-1.5 min-w-0 ${node.memoized ? "opacity-50" : ""}`}>
                        {(node.subgraphName || node.subgraphColor) && (
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: (node.subgraphName && subgraphColorMap.get(node.subgraphName)) || node.subgraphColor || DEFAULT_SUBGRAPH_COLOR }}
                          />
                        )}
                        <Tooltip content={node.name} className="min-w-0">
                          <span className="text-zinc-400 truncate block">{node.name.replace("-subgraph", "")}</span>
                        </Tooltip>
                        {node.memoized && (
                          <span className="text-xs text-cyan-600 font-medium flex-shrink-0">memoized</span>
                        )}
                      </span>
                    ) : node.type === "query" ? (
                      <span className={`flex items-center min-w-0 ${node.memoized || node.prefetch ? "opacity-50" : ""}`}>
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
                        <span className="text-teal-500/80 flex-shrink-0">query:</span>
                        <Tooltip content={node.name} className="min-w-0">
                          <span className="text-teal-400 truncate block">{node.name}</span>
                        </Tooltip>
                        {node.prefetch && (
                          <span className="text-xs text-orange-500 font-medium ml-1.5 flex-shrink-0">prefetch</span>
                        )}
                        {node.memoized && !node.prefetch && (
                          <span className="text-xs text-cyan-600 font-medium ml-1.5 flex-shrink-0">memoized</span>
                        )}
                      </span>
                    ) : (
                      <Tooltip content={node.name} className="min-w-0">
                        <span className="text-zinc-200 font-medium truncate block">
                          {node.name}
                        </span>
                      </Tooltip>
                    )}
                    {node.lcpCritical && (
                      <Tooltip content="LCP Critical" className="inline-flex ml-1.5 flex-shrink-0">
                        <span className="text-blue-400 text-xs">
                          LCP
                        </span>
                      </Tooltip>
                    )}
                    {node.type === "boundary" && node.phase === "csr" && (
                      <Tooltip content="Client Component" className="inline-flex ml-1.5 flex-shrink-0">
                        <span className="text-violet-400 text-xs">
                          CSR
                        </span>
                      </Tooltip>
                    )}
                    {node.type === "boundary" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          applyFocus(isFocused ? null : node.boundaryPath);
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
                {/* Query Latency column */}
                <td className={`text-right py-1.5 px-2 ${node.memoized || node.prefetch ? "text-zinc-700" : "text-zinc-300"}`}>
                  {isSubgraphOp
                    ? node.memoized
                      ? <span className="opacity-50">{Math.round(node.queryLatencyPctl)}ms{node.weight > 0 ? ` (${node.weight})` : ""}</span>
                      : <>{Math.round(node.queryLatencyPctl)}ms{node.weight > 0 ? ` (${node.weight})` : ""}</>

                    : node.prefetch
                      ? <span className="opacity-50">{node.queryLatencyPctl}ms</span>
                      : node.memoized
                        ? <span className="opacity-60">{node.queryLatencyPctl}ms</span>
                        : `${node.queryLatencyPctl}ms`}
                </td>
                {/* Subgraph Latency column */}
                <td className={`text-right py-1.5 px-2 ${node.memoized ? "text-zinc-700" : "text-zinc-300"}`}>
                  {isSubgraphOp && node.subgraphLatencyPctl > 0
                    ? `${node.subgraphLatencyPctl}ms`
                    : isSubgraphOp ? "\u2014" : ""}
                </td>
                {/* SLO column */}
                <td className={`text-right py-1.5 px-2 ${
                  isSubgraphOp && !node.memoized
                    ? sgNoSlo ? "text-amber-500/70 italic" : "text-zinc-500"
                    : isQuery && !node.memoized
                      ? qNoSlo ? "text-amber-500/70 italic" : "text-zinc-500"
                      : node.type === "boundary" && querySloSummary.has(node.path)
                        ? querySloSummary.get(node.path)!.sloClass
                        : "text-zinc-500"
                }`}>
                  {isSubgraphOp && !node.memoized
                    ? sgHasSlo
                      ? `${node.subgraphSlo}ms`
                      : "none"
                    : isQuery && !node.memoized
                      ? qHasSlo
                        ? `${node.querySlo}ms`
                        : "none"
                      : node.type === "boundary" && querySloSummary.has(node.path)
                        ? querySloSummary.get(node.path)!.sloLabel
                        : ""}
                </td>
                {/* Status column */}
                <td className={`text-center py-1.5 px-2 ${
                  node.type === "boundary" && querySloSummary.has(node.path)
                    ? querySloSummary.get(node.path)!.statusColor
                    : statusColor
                }`}>
                  {node.type === "boundary" && querySloSummary.has(node.path)
                    ? querySloSummary.get(node.path)!.statusIcon
                    : statusIcon}
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
