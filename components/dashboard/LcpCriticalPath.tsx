"use client";

import { useMemo } from "react";
import type { BoundaryMetric, QueryMetric } from "@/lib/metrics-store";

interface Props {
  boundaries: BoundaryMetric[];
  queries: QueryMetric[];
  pctl: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, idx)]);
}

interface BoundaryTiming {
  name: string;
  boundaryPath: string;
  wallStart: number;
  fetchDuration: number;
  renderCost: number;
  blocked: number;
  total: number;
  lcpCritical: boolean;
  queryName: string;
  cached: boolean;
}

const BOUNDARY_COLORS: Record<string, string> = {
  shell: "rgb(100, 116, 139)",
  nav: "rgb(249, 115, 22)",
  content: "rgb(163, 163, 163)",
  breadcrumbs: "rgb(163, 163, 163)",
  hero: "rgb(6, 182, 212)",
  thumbnails: "rgb(6, 182, 212)",
  pdp: "rgb(59, 130, 246)",
  bullets: "rgb(59, 130, 246)",
  options: "rgb(139, 92, 246)",
  carousels: "rgb(236, 72, 153)",
  reviews: "rgb(34, 197, 94)",
  footer: "rgb(100, 116, 139)",
};

// Expected fetch latencies for thread simulation
const EXPECTED_FETCH_MS: Record<string, number> = {
  shell: 30,
  "shell.nav": 90,
  "shell.content": 60,
  "shell.content.breadcrumbs": 55,
  "shell.content.main.hero": 35,
  "shell.content.main.thumbnails": 50,
  "shell.content.main.pdp": 55,
  "shell.content.main.bullets": 0,
  "shell.content.main.options": 0,
  "shell.content.carousels": 180,
  "shell.content.reviews": 350,
  "shell.footer": 40,
};

// Mapping from boundary path to query name
const BOUNDARY_QUERY: Record<string, string> = {
  shell: "getExperimentContext",
  "shell.nav": "getNavigation",
  "shell.content": "getContentLayout",
  "shell.content.breadcrumbs": "getBreadcrumbs",
  "shell.content.main.hero": "getHeroImage",
  "shell.content.main.thumbnails": "getThumbnails",
  "shell.content.main.pdp": "getProductInfo",
  "shell.content.main.bullets": "getProductInfo",
  "shell.content.main.options": "getProductInfo",
  "shell.content.carousels": "getRecommendations",
  "shell.content.reviews": "getReviews",
  "shell.footer": "getFooter",
};

const BOUNDARY_ORDER = [
  "shell",
  "shell.nav",
  "shell.content",
  "shell.content.breadcrumbs",
  "shell.content.main.hero",
  "shell.content.main.thumbnails",
  "shell.content.main.pdp",
  "shell.content.main.bullets",
  "shell.content.main.options",
  "shell.content.carousels",
  "shell.content.reviews",
  "shell.footer",
];

export function LcpCriticalPath({ boundaries, queries, pctl }: Props) {
  const { timings, maxMs, lcpDataReady, lcpRendered, lcpBlocked, shellEnd } =
    useMemo(() => {
      if (boundaries.length === 0) {
        return {
          timings: [],
          maxMs: 1,
          lcpDataReady: 0,
          lcpRendered: 0,
          lcpBlocked: 0,
          shellEnd: 0,
        };
      }

      const byPath = new Map<string, BoundaryMetric[]>();
      for (const b of boundaries) {
        const list = byPath.get(b.boundary_path) ?? [];
        list.push(b);
        byPath.set(b.boundary_path, list);
      }

      // Group queries by boundary_path:queryName
      const queryByKey = new Map<string, QueryMetric[]>();
      for (const q of queries) {
        const key = `${q.boundary_path}:${q.queryName}`;
        const list = queryByKey.get(key) ?? [];
        list.push(q);
        queryByKey.set(key, list);
      }

      const timings: BoundaryTiming[] = [];

      for (const path of BOUNDARY_ORDER) {
        const metrics = byPath.get(path) ?? [];
        if (metrics.length === 0) continue;

        const name = path.split(".").pop()!;
        const wallStart = percentile(
          metrics.map((m) => m.wall_start_ms),
          pctl,
        );
        const expectedFetch = EXPECTED_FETCH_MS[path] ?? 0;
        const queryName = BOUNDARY_QUERY[path] ?? "";

        // Get query metrics
        const qKey = `${path}:${queryName}`;
        const qMetrics = queryByKey.get(qKey) ?? [];
        const isCached =
          qMetrics.length > 0 && qMetrics.every((m) => m.fullyCached);
        const fetchDuration = isCached ? 0 : expectedFetch;

        timings.push({
          name,
          boundaryPath: path,
          wallStart,
          fetchDuration,
          renderCost: percentile(
            metrics.map((m) => m.render_cost_ms ?? 0),
            pctl,
          ),
          blocked: 0,
          total: percentile(
            metrics.map((m) => m.render_duration_ms),
            pctl,
          ),
          lcpCritical: metrics.some((m) => m.is_lcp_critical),
          queryName,
          cached: isCached,
        });
      }

      // Thread simulation for blocked_ms
      const sortedByFetchEnd = [...timings]
        .filter((t) => t.renderCost > 0)
        .sort(
          (a, b) =>
            a.wallStart + a.fetchDuration - (b.wallStart + b.fetchDuration),
        );
      let cursor = 0;
      for (const t of sortedByFetchEnd) {
        const fetchEnd = t.wallStart + t.fetchDuration;
        const renderStart = Math.max(cursor, fetchEnd);
        t.blocked = Math.max(0, Math.round(renderStart - fetchEnd));
        cursor = renderStart + t.renderCost;
      }

      // Shell end time (waterfall marker)
      const shell = timings.find((t) => t.name === "shell");
      const shellEnd = shell
        ? shell.wallStart + shell.fetchDuration + shell.renderCost
        : 0;

      // LCP boundary
      const pdp = timings.find((t) => t.lcpCritical && t.name === "pdp");
      const hero = timings.find((t) => t.lcpCritical && t.name === "hero");
      const lcpBoundary = pdp ?? hero;
      const lcpDataReady = lcpBoundary
        ? lcpBoundary.wallStart + lcpBoundary.fetchDuration
        : 0;
      const lcpRendered = lcpBoundary
        ? lcpBoundary.wallStart +
          lcpBoundary.fetchDuration +
          lcpBoundary.blocked +
          lcpBoundary.renderCost
        : 0;
      const lcpBlocked = lcpBoundary?.blocked ?? 0;

      const allEnds = timings.map((t) => t.wallStart + t.total);
      const totalMs = Math.max(...allEnds, lcpRendered, 1);
      const maxMs = Math.ceil(totalMs * 1.15);

      return {
        timings,
        maxMs,
        lcpDataReady,
        lcpRendered,
        lcpBlocked,
        shellEnd,
      };
    }, [boundaries, queries, pctl]);

  if (timings.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        No LCP critical path data available.
      </div>
    );
  }

  // Render timeline
  const renderTimeline = timings
    .filter((t) => t.renderCost > 0)
    .sort(
      (a, b) => a.wallStart + a.fetchDuration - (b.wallStart + b.fetchDuration),
    );

  let threadCursor = 0;
  const renderBlocks: {
    name: string;
    start: number;
    duration: number;
    lcpCritical: boolean;
  }[] = [];
  for (const t of renderTimeline) {
    const fetchEnd = t.wallStart + t.fetchDuration;
    const renderStart = Math.max(threadCursor, fetchEnd);
    renderBlocks.push({
      name: t.name,
      start: renderStart,
      duration: t.renderCost,
      lcpCritical: t.lcpCritical,
    });
    threadCursor = renderStart + t.renderCost;
  }

  return (
    <div className="space-y-6">
      <div className="text-xs text-zinc-500 mb-2">
        Shows how GQL queries overlap on the server, but sync rendering
        serializes on the single Node.js thread.
        {lcpBlocked > 0 && (
          <span className="text-amber-400 ml-2">
            LCP boundary was blocked {lcpBlocked}ms by other renders.
          </span>
        )}
      </div>

      {/* Time axis */}
      <div className="flex justify-between text-xs text-zinc-600 font-mono">
        <span>0ms</span>
        <span>{Math.round(maxMs / 4)}ms</span>
        <span>{Math.round(maxMs / 2)}ms</span>
        <span>{Math.round((maxMs * 3) / 4)}ms</span>
        <span>{maxMs}ms</span>
      </div>

      {/* Query timeline (with subgraph op sub-bars) */}
      <div>
        <div className="text-xs text-zinc-400 mb-2 font-medium">
          Queries <span className="text-zinc-600">(concurrent async I/O)</span>
        </div>
        <div className="relative bg-zinc-900 rounded border border-zinc-800 p-3">
          {/* Grid lines */}
          <div className="absolute inset-3 flex justify-between pointer-events-none">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={pct}
                className="w-px bg-zinc-800"
                style={{ height: "100%" }}
              />
            ))}
          </div>

          {/* Waterfall marker: shell end */}

          <div className="space-y-1.5 relative">
            {timings
              .filter((t) => t.name !== "shell")
              .map((t) => {
                const leftPct = (t.wallStart / maxMs) * 100;
                const widthPct = Math.max(
                  (t.fetchDuration / maxMs) * 100,
                  t.cached ? 0.8 : 1.5,
                );
                const color = BOUNDARY_COLORS[t.name] ?? "rgb(100, 116, 139)";

                return (
                  <div key={t.boundaryPath} className="relative h-7">
                    {/* Query bar (outer) */}
                    <div
                      className={`absolute top-0 h-full rounded flex items-center overflow-hidden ${
                        t.cached
                          ? "opacity-40 border border-dashed border-zinc-600"
                          : ""
                      }`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        backgroundColor: t.cached ? "transparent" : color,
                        opacity: t.lcpCritical ? 1 : 0.7,
                      }}
                    >
                      <span className="text-xs text-white px-1.5 truncate font-mono">
                        {t.name}{" "}
                        {t.cached ? "(cached)" : `(${t.fetchDuration}ms)`}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* LCP data ready marker */}
          {lcpDataReady > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-blue-400/50"
              style={{ left: `calc(${(lcpDataReady / maxMs) * 100}% + 12px)` }}
            />
          )}
        </div>
      </div>

      {/* Render timeline */}
      <div>
        <div className="text-xs text-zinc-400 mb-2 font-medium">
          Renders{" "}
          <span className="text-zinc-600">(serialized on single thread)</span>
        </div>
        <div className="relative bg-zinc-900 rounded border border-zinc-800 p-3">
          {/* Grid lines */}
          <div className="absolute inset-3 flex justify-between pointer-events-none">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={pct}
                className="w-px bg-zinc-800"
                style={{ height: "100%" }}
              />
            ))}
          </div>

          <div className="relative h-8">
            {renderBlocks.map((block) => {
              const leftPct = (block.start / maxMs) * 100;
              const widthPct = Math.max((block.duration / maxMs) * 100, 1.5);
              const color = BOUNDARY_COLORS[block.name] ?? "rgb(100, 116, 139)";

              return (
                <div
                  key={block.name}
                  className={`absolute top-0 h-full rounded flex items-center overflow-hidden ${
                    block.lcpCritical ? "ring-1 ring-blue-400" : ""
                  }`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: color,
                  }}
                >
                  <span className="text-xs text-white px-1 truncate font-mono">
                    {block.name} ({block.duration}ms)
                  </span>
                </div>
              );
            })}
          </div>

          {/* Markers */}
          <div className="relative h-6">
            {lcpDataReady > 0 && (
              <div
                className="absolute top-0 flex items-center"
                style={{ left: `${(lcpDataReady / maxMs) * 100}%` }}
              >
                <div className="w-px h-4 bg-blue-400" />
                <span className="text-xs text-blue-400 ml-1 font-mono whitespace-nowrap">
                  LCP data ready @ {lcpDataReady}ms
                </span>
              </div>
            )}
          </div>
          <div className="relative h-6">
            {lcpRendered > 0 && (
              <div
                className="absolute top-0 flex items-center"
                style={{ left: `${(lcpRendered / maxMs) * 100}%` }}
              >
                <div className="w-px h-4 bg-green-400" />
                <span className="text-xs text-green-400 ml-1 font-mono whitespace-nowrap">
                  LCP rendered @ {lcpRendered}ms
                  {lcpBlocked > 0 && (
                    <span className="text-amber-400">
                      {" "}
                      (+{lcpBlocked}ms blocked)
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
        <div>
          <span className="text-zinc-500">Shell (waterfall): </span>
          <span className="text-amber-400">
            {timings.find((t) => t.name === "shell")?.total ?? 0}ms
          </span>
        </div>
        <div>
          <span className="text-zinc-500">Nav render cost: </span>
          <span className="text-orange-400">
            {timings.find((t) => t.name === "nav")?.renderCost ?? 0}ms
          </span>
        </div>
        <div>
          <span className="text-zinc-500">LCP query: </span>
          <span className="text-zinc-300">
            {timings.find((t) => t.name === "pdp")?.fetchDuration ??
              timings.find((t) => t.name === "hero")?.fetchDuration ??
              0}
            ms
          </span>
        </div>
        {lcpBlocked > 0 && (
          <div>
            <span className="text-zinc-500">LCP blocked: </span>
            <span className="text-amber-400 font-medium">{lcpBlocked}ms</span>
          </div>
        )}
        <div>
          <span className="text-zinc-500">Total to LCP render: </span>
          <span className="text-blue-400 font-medium">{lcpRendered}ms</span>
        </div>
      </div>
    </div>
  );
}
