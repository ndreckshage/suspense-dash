"use client";

import { useMemo } from "react";
import type { BoundaryMetric, FetchMetric } from "@/lib/metrics-store";

interface Props {
  boundaries: BoundaryMetric[];
  fetches: FetchMetric[];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, idx)]);
}

interface BoundaryTiming {
  name: string;
  wallStart: number;
  fetchDuration: number;
  renderCost: number;
  blocked: number;
  total: number;
  lcpCritical: boolean;
}

const BOUNDARY_COLORS: Record<string, string> = {
  shell: "rgb(100, 116, 139)", // slate
  nav: "rgb(249, 115, 22)",    // orange
  breadcrumbs: "rgb(163, 163, 163)", // neutral
  pdp: "rgb(59, 130, 246)",    // blue
  details: "rgb(139, 92, 246)", // violet
  carousels: "rgb(236, 72, 153)", // pink
  reviews: "rgb(34, 197, 94)",  // green
  footer: "rgb(100, 116, 139)", // slate
};

const BOUNDARY_ORDER = [
  "shell", "shell.nav", "shell.pdp.breadcrumbs", "shell.pdp",
  "shell.pdp.details", "shell.pdp.carousels", "shell.pdp.reviews", "shell.footer",
];

// Expected fetch latencies (mirrors simulatedFetch base ms from the page).
// Measured fetch_duration_ms is inflated by thread blocking, so we use these
// configured values for accurate thread simulation.
const EXPECTED_FETCH_MS: Record<string, number> = {
  "shell": 50,
  "shell.nav": 150,
  "shell.pdp": 200,
  "shell.pdp.breadcrumbs": 80,
  "shell.pdp.details": 120,
  "shell.pdp.carousels": 350,
  "shell.pdp.reviews": 500,
  "shell.footer": 60,
};

export function LcpCriticalPath({ boundaries, fetches }: Props) {
  const { timings, maxMs, lcpDataReady, lcpRendered, lcpBlocked } = useMemo(() => {
    if (boundaries.length === 0) {
      return { timings: [], maxMs: 1, lcpDataReady: 0, lcpRendered: 0, lcpBlocked: 0 };
    }

    // Group boundary metrics by path
    const byPath = new Map<string, BoundaryMetric[]>();
    for (const b of boundaries) {
      const list = byPath.get(b.boundary_path) ?? [];
      list.push(b);
      byPath.set(b.boundary_path, list);
    }

    const timings: BoundaryTiming[] = [];

    for (const path of BOUNDARY_ORDER) {
      const metrics = byPath.get(path) ?? [];
      if (metrics.length === 0) continue;

      const name = path.split(".").pop()!;
      const wallStart = percentile(metrics.map((m) => m.wall_start_ms), 50);
      // Use expected fetch latency for simulation (measured values are inflated
      // by thread blocking since JS continuations wait for the thread)
      const expectedFetch = EXPECTED_FETCH_MS[path];
      const fetchDuration = expectedFetch ?? percentile(
        metrics.map((m) => m.fetch_duration_ms ?? m.render_duration_ms), 50
      );
      timings.push({
        name,
        wallStart,
        fetchDuration,
        renderCost: percentile(metrics.map((m) => m.render_cost_ms ?? 0), 50),
        blocked: 0, // computed below via thread simulation
        total: percentile(metrics.map((m) => m.render_duration_ms), 50),
        lcpCritical: metrics.some((m) => m.is_lcp_critical),
      });
    }

    // Compute blocked_ms via thread simulation
    const sortedByFetchEnd = [...timings]
      .filter((t) => t.renderCost > 0)
      .sort((a, b) => (a.wallStart + a.fetchDuration) - (b.wallStart + b.fetchDuration));
    let cursor = 0;
    for (const t of sortedByFetchEnd) {
      const fetchEnd = t.wallStart + t.fetchDuration;
      const renderStart = Math.max(cursor, fetchEnd);
      t.blocked = Math.max(0, Math.round(renderStart - fetchEnd));
      cursor = renderStart + t.renderCost;
    }

    // Find LCP boundary (pdp)
    const pdp = timings.find((t) => t.lcpCritical && t.name === "pdp");
    const lcpDataReady = pdp ? pdp.wallStart + pdp.fetchDuration : 0;
    // LCP rendered = data ready + blocked + render cost
    const lcpRendered = pdp ? pdp.wallStart + pdp.fetchDuration + pdp.blocked + pdp.renderCost : 0;
    const lcpBlocked = pdp?.blocked ?? 0;

    // Compute max time across all boundaries
    const allEnds = timings.map((t) => t.wallStart + t.total);
    const totalMs = Math.max(...allEnds, lcpRendered, 1);
    const maxMs = Math.ceil(totalMs * 1.15);

    return { timings, maxMs, lcpDataReady, lcpRendered, lcpBlocked };
  }, [boundaries, fetches]);

  if (timings.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        No LCP critical path data available.
      </div>
    );
  }

  // Build render timeline: boundaries sorted by fetch completion time (wall_start + fetch_duration)
  // This approximates the order React processes them on the thread
  const renderTimeline = timings
    .filter((t) => t.renderCost > 0)
    .sort((a, b) => (a.wallStart + a.fetchDuration) - (b.wallStart + b.fetchDuration));

  // Compute serialized render positions
  let threadCursor = 0;
  const renderBlocks: { name: string; start: number; duration: number; lcpCritical: boolean }[] = [];
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
        Shows how async fetches overlap on the server, but sync rendering serializes on the single Node.js thread.
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

      {/* Fetch timeline */}
      <div>
        <div className="text-xs text-zinc-400 mb-2 font-medium">
          Fetches <span className="text-zinc-600">(concurrent async I/O)</span>
        </div>
        <div className="relative bg-zinc-900 rounded border border-zinc-800 p-3">
          {/* Grid lines */}
          <div className="absolute inset-3 flex justify-between pointer-events-none">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div key={pct} className="w-px bg-zinc-800" style={{ height: "100%" }} />
            ))}
          </div>

          <div className="space-y-1.5 relative">
            {timings.map((t) => {
              const leftPct = (t.wallStart / maxMs) * 100;
              const widthPct = Math.max((t.fetchDuration / maxMs) * 100, 1.5);
              const color = BOUNDARY_COLORS[t.name] ?? "rgb(100, 116, 139)";

              return (
                <div key={t.name} className="relative h-6">
                  <div
                    className="absolute top-0 h-full rounded flex items-center overflow-hidden"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: color,
                      opacity: t.lcpCritical ? 1 : 0.7,
                    }}
                  >
                    <span className="text-xs text-white px-1.5 truncate font-mono">
                      {t.name} ({t.fetchDuration}ms)
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
          Renders <span className="text-zinc-600">(serialized on single thread)</span>
        </div>
        <div className="relative bg-zinc-900 rounded border border-zinc-800 p-3">
          {/* Grid lines */}
          <div className="absolute inset-3 flex justify-between pointer-events-none">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div key={pct} className="w-px bg-zinc-800" style={{ height: "100%" }} />
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
          <div className="relative h-6 mt-2">
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
                    <span className="text-amber-400"> (+{lcpBlocked}ms blocked)</span>
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
          <span className="text-zinc-500">Shell blocking: </span>
          <span className="text-zinc-300">
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
          <span className="text-zinc-500">LCP fetch: </span>
          <span className="text-zinc-300">
            {timings.find((t) => t.name === "pdp")?.fetchDuration ?? 0}ms
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
