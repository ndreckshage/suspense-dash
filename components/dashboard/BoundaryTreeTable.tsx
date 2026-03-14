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

interface Props {
  boundaries: BoundaryMetric[];
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  pctl: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, idx)]);
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
  expectedFetchMs?: number;
}

const TREE_STRUCTURE: TreeItem[] = [
  // shell
  { path: "shell", name: "shell", type: "boundary", boundaryPath: "shell", lcpCritical: true, expectedFetchMs: 30 },
  { path: "shell.query", name: "getExperimentContext", type: "query", boundaryPath: "shell", queryName: "getExperimentContext" },
  { path: "shell.query.op", name: "experiment.context", type: "subgraph-op", boundaryPath: "shell", queryName: "getExperimentContext", opName: "experiment.context", subgraphName: "experimentation-subgraph" },

  // nav
  { path: "shell.nav", name: "nav", type: "boundary", boundaryPath: "shell.nav", expectedFetchMs: 90 },
  { path: "shell.nav.query", name: "getNavigation", type: "query", boundaryPath: "shell.nav", queryName: "getNavigation" },
  { path: "shell.nav.query.op1", name: "cms.navigation", type: "subgraph-op", boundaryPath: "shell.nav", queryName: "getNavigation", opName: "cms.navigation", subgraphName: "cms-subgraph" },

  // content (CMS layout fetch)
  { path: "shell.content", name: "content", type: "boundary", boundaryPath: "shell.content", expectedFetchMs: 60 },
  { path: "shell.content.query", name: "getContentLayout", type: "query", boundaryPath: "shell.content", queryName: "getContentLayout" },
  { path: "shell.content.query.op1", name: "cms.layout", type: "subgraph-op", boundaryPath: "shell.content", queryName: "getContentLayout", opName: "cms.layout", subgraphName: "cms-subgraph" },

  // breadcrumbs
  { path: "shell.content.breadcrumbs", name: "breadcrumbs", type: "boundary", boundaryPath: "shell.content.breadcrumbs", expectedFetchMs: 55 },
  { path: "shell.content.breadcrumbs.query", name: "getBreadcrumbs", type: "query", boundaryPath: "shell.content.breadcrumbs", queryName: "getBreadcrumbs" },
  { path: "shell.content.breadcrumbs.query.op1", name: "category.tree", type: "subgraph-op", boundaryPath: "shell.content.breadcrumbs", queryName: "getBreadcrumbs", opName: "category.tree", subgraphName: "cms-subgraph" },

  // hero
  { path: "shell.content.main.hero", name: "hero", type: "boundary", boundaryPath: "shell.content.main.hero", lcpCritical: true, expectedFetchMs: 35 },
  { path: "shell.content.main.hero.query", name: "getHeroImage", type: "query", boundaryPath: "shell.content.main.hero", queryName: "getHeroImage" },
  { path: "shell.content.main.hero.query.op1", name: "media.heroImage", type: "subgraph-op", boundaryPath: "shell.content.main.hero", queryName: "getHeroImage", opName: "media.heroImage", subgraphName: "media-subgraph" },

  // thumbnails (own query, no cache)
  { path: "shell.content.main.thumbnails", name: "thumbnails", type: "boundary", boundaryPath: "shell.content.main.thumbnails", expectedFetchMs: 50 },
  { path: "shell.content.main.thumbnails.query", name: "getThumbnails", type: "query", boundaryPath: "shell.content.main.thumbnails", queryName: "getThumbnails" },
  { path: "shell.content.main.thumbnails.query.op1", name: "media.thumbnails", type: "subgraph-op", boundaryPath: "shell.content.main.thumbnails", queryName: "getThumbnails", opName: "media.thumbnails", subgraphName: "media-subgraph" },

  // pdp (LCP critical — getProductInfo + getProductPricing in parallel)
  { path: "shell.content.main.pdp", name: "pdp", type: "boundary", boundaryPath: "shell.content.main.pdp", lcpCritical: true, expectedFetchMs: 55 },
  { path: "shell.content.main.pdp.query1", name: "getProductInfo", type: "query", boundaryPath: "shell.content.main.pdp", queryName: "getProductInfo" },
  { path: "shell.content.main.pdp.query1.op1", name: "product.core", type: "subgraph-op", boundaryPath: "shell.content.main.pdp", queryName: "getProductInfo", opName: "product.core", subgraphName: "product-subgraph" },
  { path: "shell.content.main.pdp.query1.op2", name: "product.bullets", type: "subgraph-op", boundaryPath: "shell.content.main.pdp", queryName: "getProductInfo", opName: "product.bullets", subgraphName: "product-subgraph" },
  { path: "shell.content.main.pdp.query2", name: "getProductPricing", type: "query", boundaryPath: "shell.content.main.pdp", queryName: "getProductPricing" },
  { path: "shell.content.main.pdp.query2.op1", name: "pricing.current", type: "subgraph-op", boundaryPath: "shell.content.main.pdp", queryName: "getProductPricing", opName: "pricing.current", subgraphName: "pricing-subgraph" },
  { path: "shell.content.main.pdp.query2.op2", name: "inventory.availability", type: "subgraph-op", boundaryPath: "shell.content.main.pdp", queryName: "getProductPricing", opName: "inventory.availability", subgraphName: "inventory-subgraph" },
  { path: "shell.content.main.pdp.query2.op3", name: "reviews.summary", type: "subgraph-op", boundaryPath: "shell.content.main.pdp", queryName: "getProductPricing", opName: "reviews.summary", subgraphName: "reviews-subgraph" },

  // bullets (getProductInfo cache hit)
  { path: "shell.content.main.bullets", name: "bullets", type: "boundary", boundaryPath: "shell.content.main.bullets", expectedFetchMs: 0 },
  { path: "shell.content.main.bullets.query", name: "getProductInfo", type: "query", boundaryPath: "shell.content.main.bullets", queryName: "getProductInfo" },

  // options (getProductInfo cache hit)
  { path: "shell.content.main.options", name: "options", type: "boundary", boundaryPath: "shell.content.main.options", expectedFetchMs: 0 },
  { path: "shell.content.main.options.query", name: "getProductInfo", type: "query", boundaryPath: "shell.content.main.options", queryName: "getProductInfo" },

  // carousels
  { path: "shell.content.carousels", name: "carousels", type: "boundary", boundaryPath: "shell.content.carousels", expectedFetchMs: 180 },
  { path: "shell.content.carousels.query", name: "getRecommendations", type: "query", boundaryPath: "shell.content.carousels", queryName: "getRecommendations" },
  { path: "shell.content.carousels.query.op1", name: "reco.personalized", type: "subgraph-op", boundaryPath: "shell.content.carousels", queryName: "getRecommendations", opName: "reco.personalized", subgraphName: "reco-subgraph" },
  { path: "shell.content.carousels.query.op2", name: "product.cards", type: "subgraph-op", boundaryPath: "shell.content.carousels", queryName: "getRecommendations", opName: "product.cards", subgraphName: "product-subgraph" },
  { path: "shell.content.carousels.query.op3", name: "pricing.batch", type: "subgraph-op", boundaryPath: "shell.content.carousels", queryName: "getRecommendations", opName: "pricing.batch", subgraphName: "pricing-subgraph" },

  // reviews
  { path: "shell.content.reviews", name: "reviews", type: "boundary", boundaryPath: "shell.content.reviews", expectedFetchMs: 350 },
  { path: "shell.content.reviews.query", name: "getReviews", type: "query", boundaryPath: "shell.content.reviews", queryName: "getReviews" },
  { path: "shell.content.reviews.query.op1", name: "reviews.list", type: "subgraph-op", boundaryPath: "shell.content.reviews", queryName: "getReviews", opName: "reviews.list", subgraphName: "reviews-subgraph" },

  // footer
  { path: "shell.footer", name: "footer", type: "boundary", boundaryPath: "shell.footer", expectedFetchMs: 40 },
  { path: "shell.footer.query", name: "getFooter", type: "query", boundaryPath: "shell.footer", queryName: "getFooter" },
  { path: "shell.footer.query.op1", name: "cms.footer", type: "subgraph-op", boundaryPath: "shell.footer", queryName: "getFooter", opName: "cms.footer", subgraphName: "cms-subgraph" },
];

// Boundary-level SLOs
const BOUNDARY_SLOS: Record<string, number> = {
  shell: 60,
  "shell.nav": 200,
  "shell.content": 120,
  "shell.content.breadcrumbs": 120,
  "shell.content.main.hero": 60,
  "shell.content.main.thumbnails": 120,
  "shell.content.main.pdp": 200,
  "shell.content.main.bullets": 80,
  "shell.content.main.options": 80,
  "shell.content.carousels": 400,
  "shell.content.reviews": 550,
  "shell.footer": 100,
};

// All boundary paths for collapse/expand
const ALL_BOUNDARY_PATHS = TREE_STRUCTURE
  .filter((t) => t.type === "boundary")
  .map((t) => t.boundaryPath);

// Map each non-boundary item to its parent boundary path
function getParentBoundaryPath(item: TreeItem): string {
  return item.boundaryPath;
}

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

function getDepth(item: TreeItem): number {
  return item.path.split(".").length - 1;
}

export function BoundaryTreeTable({ boundaries, queries, subgraphOps, pctl }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ALL_BOUNDARY_PATHS));

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setExpanded(new Set(ALL_BOUNDARY_PATHS)), []);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

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

    // Precompute which boundaries have children in TREE_STRUCTURE
    const boundaryHasChildren = new Set<string>();
    for (const item of TREE_STRUCTURE) {
      if (item.type !== "boundary") {
        boundaryHasChildren.add(item.boundaryPath);
      }
    }

    const nodes: TreeNode[] = [];

    for (const item of TREE_STRUCTURE) {
      const depth = getDepth(item);

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
          lcpCritical: item.lcpCritical ?? metrics.some((m) => m.is_lcp_critical),
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

    // Thread simulation for blocked_ms
    const expectedFetchByPath = new Map<string, number>();
    for (const item of TREE_STRUCTURE) {
      if (item.type === "boundary" && item.expectedFetchMs !== undefined) {
        expectedFetchByPath.set(item.boundaryPath, item.expectedFetchMs);
      }
    }

    const boundaryNodes = nodes.filter(
      (n) => n.type === "boundary" && n.renderCostPctl > 0
    );
    const sorted = [...boundaryNodes].sort((a, b) => {
      const aEnd = a.wallStartPctl + (expectedFetchByPath.get(a.boundaryPath) ?? a.fetchPctl);
      const bEnd = b.wallStartPctl + (expectedFetchByPath.get(b.boundaryPath) ?? b.fetchPctl);
      return aEnd - bEnd;
    });
    let threadCursor = 0;
    for (const bn of sorted) {
      const expectedFetch = expectedFetchByPath.get(bn.boundaryPath) ?? bn.fetchPctl;
      const fetchEnd = bn.wallStartPctl + expectedFetch;
      const renderStart = Math.max(threadCursor, fetchEnd);
      const blocked = renderStart - fetchEnd;
      const nodeIdx = nodes.findIndex((n) => n.path === bn.path);
      if (nodeIdx >= 0) {
        nodes[nodeIdx].blockedPctl = Math.max(0, Math.round(blocked));
      }
      threadCursor = renderStart + bn.renderCostPctl;
    }

    return nodes;
  }, [boundaries, queries, subgraphOps, pctl]);

  // Filter visible nodes based on expanded state
  const visibleNodes = useMemo(() => {
    return treeNodes.filter((node) => {
      if (node.type === "boundary") return true;
      // Non-boundary nodes are visible if their parent boundary is expanded
      return expanded.has(node.boundaryPath);
    });
  }, [treeNodes, expanded]);

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
      {/* Subgraph legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-zinc-500">
        {Object.entries(SUBGRAPHS).map(([name, { color }]) => (
          <span key={name} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            {name.replace("-subgraph", "")}
          </span>
        ))}
      </div>
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
      <table className="w-full text-sm font-mono table-fixed">
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

            return (
              <tr
                key={node.path}
                className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${
                  node.lcpCritical ? "border-l-2 border-l-blue-500/50" : ""
                }`}
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
