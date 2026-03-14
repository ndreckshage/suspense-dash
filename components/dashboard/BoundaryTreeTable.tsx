"use client";

import { useMemo } from "react";
import type { BoundaryMetric, FetchMetric } from "@/lib/metrics-store";

interface Props {
  boundaries: BoundaryMetric[];
  fetches: FetchMetric[];
}

// Default SLOs per boundary (ms)
const DEFAULT_SLOS: Record<string, number> = {
  shell: 100,
  "shell.nav": 200,
  "shell.pdp": 300,
  "shell.pdp.breadcrumbs": 120,
  "shell.pdp.details": 180,
  "shell.pdp.carousels": 500,
  "shell.pdp.reviews": 600,
  "shell.footer": 100,
};

const DEFAULT_FETCH_SLOS: Record<string, number> = {
  "session-config": 80,
  "nav-config": 200,
  "product-api": 300,
  "category-path": 120,
  "pricing-api": 180,
  "reco-engine": 500,
  "reviews-service": 600,
  "footer-config": 100,
};

interface TreeNode {
  name: string;
  path: string;
  depth: number;
  isLast: boolean;
  ancestors: boolean[]; // which ancestors are "last" (for tree line rendering)
  type: "boundary" | "fetch";
  wallStartP50: number;
  p50: number;
  p95: number;
  p99: number;
  slo: number;
  lcpCritical: boolean;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, idx)]);
}

// Define the tree structure explicitly to match the PDP hierarchy
const TREE_STRUCTURE: {
  path: string;
  name: string;
  type: "boundary" | "fetch";
  fetchName?: string;
  lcpCritical?: boolean;
}[] = [
  { path: "shell", name: "shell", type: "boundary", lcpCritical: true },
  { path: "shell", name: "session-config", type: "fetch", fetchName: "session-config" },
  { path: "shell.nav", name: "nav", type: "boundary" },
  { path: "shell.nav", name: "nav-config", type: "fetch", fetchName: "nav-config" },
  { path: "shell.pdp", name: "pdp", type: "boundary", lcpCritical: true },
  { path: "shell.pdp", name: "product-api", type: "fetch", fetchName: "product-api", lcpCritical: true },
  { path: "shell.pdp.breadcrumbs", name: "breadcrumbs", type: "boundary" },
  { path: "shell.pdp.breadcrumbs", name: "category-path", type: "fetch", fetchName: "category-path" },
  { path: "shell.pdp.details", name: "details", type: "boundary" },
  { path: "shell.pdp.details", name: "pricing-api", type: "fetch", fetchName: "pricing-api" },
  { path: "shell.pdp.carousels", name: "carousels", type: "boundary" },
  { path: "shell.pdp.carousels", name: "reco-engine", type: "fetch", fetchName: "reco-engine" },
  { path: "shell.pdp.reviews", name: "reviews", type: "boundary" },
  { path: "shell.pdp.reviews", name: "reviews-service", type: "fetch", fetchName: "reviews-service" },
  { path: "shell.footer", name: "footer", type: "boundary" },
  { path: "shell.footer", name: "footer-config", type: "fetch", fetchName: "footer-config" },
];

function getDepth(path: string, type: "boundary" | "fetch"): number {
  const parts = path.split(".");
  // For boundaries, depth = how deep in the tree
  // shell = 0, shell.nav = 1, shell.pdp.details = 2
  if (type === "boundary") {
    return parts.length - 1;
  }
  // For fetches, they're children of their boundary
  return parts.length;
}

export function BoundaryTreeTable({ boundaries, fetches }: Props) {
  const treeNodes = useMemo(() => {
    if (boundaries.length === 0 && fetches.length === 0) return [];

    // Group boundary metrics by path
    const boundaryByPath = new Map<string, BoundaryMetric[]>();
    for (const b of boundaries) {
      const list = boundaryByPath.get(b.boundary_path) ?? [];
      list.push(b);
      boundaryByPath.set(b.boundary_path, list);
    }

    // Group fetch metrics by name+boundary
    const fetchByKey = new Map<string, FetchMetric[]>();
    for (const f of fetches) {
      const key = `${f.boundary_path}:${f.fetch_name}`;
      const list = fetchByKey.get(key) ?? [];
      list.push(f);
      fetchByKey.set(key, list);
    }

    const nodes: TreeNode[] = [];

    // Determine which nodes are "last" at each level for tree rendering
    // Group by parent path to find last children
    const childrenByParent = new Map<string, typeof TREE_STRUCTURE>();
    for (const item of TREE_STRUCTURE) {
      const parentPath =
        item.type === "fetch"
          ? item.path
          : item.path.includes(".")
            ? item.path.split(".").slice(0, -1).join(".")
            : "";
      const key = `${parentPath}:${item.type === "fetch" ? "fetch" : "boundary"}`;
      // Actually group all children under same visual parent
      const visualParent = item.type === "fetch"
        ? item.path
        : item.path.includes(".")
          ? item.path.split(".").slice(0, -1).join(".")
          : "";
      const list = childrenByParent.get(visualParent) ?? [];
      list.push(item);
      childrenByParent.set(visualParent, list);
    }

    for (let i = 0; i < TREE_STRUCTURE.length; i++) {
      const item = TREE_STRUCTURE[i];
      const depth = getDepth(item.path, item.type);

      // Determine if this is the last sibling at its depth
      const visualParent = item.type === "fetch"
        ? item.path
        : item.path.includes(".")
          ? item.path.split(".").slice(0, -1).join(".")
          : "";
      const siblings = childrenByParent.get(visualParent) ?? [];
      const isLast = siblings[siblings.length - 1] === item;

      if (item.type === "boundary") {
        const metrics = boundaryByPath.get(item.path) ?? [];
        const durations = metrics.map((m) => m.render_duration_ms);
        const wallStarts = metrics.map((m) => m.wall_start_ms);
        const lcpCritical =
          item.lcpCritical ?? metrics.some((m) => m.is_lcp_critical);

        nodes.push({
          name: item.name,
          path: item.path,
          depth,
          isLast,
          ancestors: [],
          type: "boundary",
          wallStartP50: percentile(wallStarts, 50),
          p50: percentile(durations, 50),
          p95: percentile(durations, 95),
          p99: percentile(durations, 99),
          slo: DEFAULT_SLOS[item.path] ?? 500,
          lcpCritical,
        });
      } else {
        const key = `${item.path}:${item.fetchName}`;
        const metrics = fetchByKey.get(key) ?? [];
        const durations = metrics.map((m) => m.duration_ms);

        nodes.push({
          name: item.name,
          path: `${item.path}:${item.fetchName}`,
          depth,
          isLast,
          ancestors: [],
          type: "fetch",
          wallStartP50: 0,
          p50: percentile(durations, 50),
          p95: percentile(durations, 95),
          p99: percentile(durations, 99),
          slo: DEFAULT_FETCH_SLOS[item.fetchName!] ?? 500,
          lcpCritical: item.lcpCritical ?? false,
        });
      }
    }

    return nodes;
  }, [boundaries, fetches]);

  if (treeNodes.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        No metrics data. Generate load to populate the dashboard.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-mono table-fixed">
        <thead>
          <tr className="text-zinc-500 text-xs border-b border-zinc-800">
            <th className="text-left py-2 px-2 font-normal" style={{ width: "35%" }}>
              Boundary / Fetch
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "10%" }}>
              Wall Start
              <br />
              <span className="text-zinc-600">p50</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "10%" }}>
              Duration
              <br />
              <span className="text-zinc-600">p50</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "10%" }}>
              <br />
              <span className="text-zinc-600">p95</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "10%" }}>
              <br />
              <span className="text-zinc-600">p99</span>
            </th>
            <th className="text-right py-2 px-2 font-normal" style={{ width: "10%" }}>SLO</th>
            <th className="text-center py-2 px-2 font-normal" style={{ width: "8%" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {treeNodes.map((node) => {
            const sloRatio = node.p99 / node.slo;
            const statusColor =
              sloRatio > 1
                ? "text-red-400"
                : sloRatio > 0.8
                  ? "text-yellow-400"
                  : "text-green-400";
            const statusIcon =
              sloRatio > 1 ? "!!!" : sloRatio > 0.8 ? "!!" : "OK";

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
                    style={{ paddingLeft: `${node.depth * 20}px` }}
                  >
                    {node.depth > 0 && (
                      <span className="text-zinc-700 mr-1.5 flex-shrink-0">
                        <TreeConnector />
                      </span>
                    )}
                    {node.type === "fetch" ? (
                      <span className="text-zinc-500">
                        fetch:
                        <span className="text-zinc-400">{node.name}</span>
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
                  {node.type === "boundary" ? `${node.wallStartP50}ms` : ""}
                </td>
                <td className="text-right py-1.5 px-2 text-zinc-300">
                  {node.p50}ms
                </td>
                <td className="text-right py-1.5 px-2 text-zinc-300">
                  {node.p95}ms
                </td>
                <td className="text-right py-1.5 px-2 text-zinc-300">
                  {node.p99}ms
                </td>
                <td className="text-right py-1.5 px-2 text-zinc-500">
                  {node.slo}ms
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
      {/* Vertical line from top */}
      <line x1="4" y1="0" x2="4" y2="8" />
      {/* Horizontal line to right */}
      <line x1="4" y1="8" x2="14" y2="8" />
    </svg>
  );
}
