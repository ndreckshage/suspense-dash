"use client";

import { useMemo, useState, useRef, useCallback, type ReactNode } from "react";
import type { BoundaryMetric, QueryMetric } from "@/lib/metrics-store";
import type { LoAFEntry, NavigationTiming } from "@/lib/client-metrics-store";
import { percentile } from "@/lib/percentile";

function Tooltip({ content, children, className, style }: { content: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const onEnter = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
    setShow(true);
  }, []);

  const onMove = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  const onLeave = useCallback(() => setShow(false), []);

  return (
    <div
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={className ?? "relative"}
      style={style}
    >
      {children}
      {show && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: pos.x + 12, top: pos.y - 8 }}
        >
          <div className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 shadow-xl text-xs font-mono text-zinc-200 max-w-sm">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

interface TooltipLine {
  label: string;
  value: string | number;
  color?: string;
}

function TooltipContent({ title, lines, tag }: { title: string; lines: TooltipLine[]; tag?: string }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-zinc-100 font-medium">{title}</span>
        {tag && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">{tag}</span>}
      </div>
      {lines.map((line, i) => (
        <div key={i} className="flex justify-between gap-4">
          <span className="text-zinc-500">{line.label}</span>
          <span className={line.color ?? "text-zinc-200"}>{line.value}</span>
        </div>
      ))}
    </>
  );
}

interface Props {
  boundaries: BoundaryMetric[];
  queries: QueryMetric[];
  pctl: number;
  hydrationTimes?: Record<string, number>;
  loafEntries?: Record<string, LoAFEntry[]>;
  navigationTimings?: Record<string, NavigationTiming>;
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
  Layout: "rgb(100, 116, 139)",
  Nav: "rgb(249, 115, 22)",
  Content: "rgb(163, 163, 163)",
  Breadcrumbs: "rgb(163, 163, 163)",
  Hero: "rgb(6, 182, 212)",
  Thumbnails: "rgb(6, 182, 212)",
  Title: "rgb(59, 130, 246)",
  Pricing: "rgb(139, 92, 246)",
  Bullets: "rgb(59, 130, 246)",
  Options: "rgb(139, 92, 246)",
  AddToCart: "rgb(139, 92, 246)",
  Carousels: "rgb(236, 72, 153)",
  Reviews: "rgb(34, 197, 94)",
  Footer: "rgb(100, 116, 139)",
  // CSR boundaries
  Cart: "rgb(168, 85, 247)",
  Favorites: "rgb(168, 85, 247)",
  ReviewsQA: "rgb(34, 197, 94)",
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function CriticalInitPath({ boundaries, queries, pctl, hydrationTimes, loafEntries, navigationTimings }: Props) {
  // Separate SSR and CSR metrics
  const ssrBoundaries = useMemo(
    () => boundaries.filter((b) => b.phase !== "csr"),
    [boundaries],
  );
  const csrBoundaries = useMemo(
    () => boundaries.filter((b) => b.phase === "csr"),
    [boundaries],
  );
  const ssrQueries = useMemo(
    () => queries.filter((q) => q.phase !== "csr"),
    [queries],
  );
  const csrQueries = useMemo(
    () => queries.filter((q) => q.phase === "csr"),
    [queries],
  );

  // Compute hydration time across page loads at selected percentile
  const hydrationMs = useMemo(() => {
    if (!hydrationTimes) return 0;
    const values = Object.values(hydrationTimes);
    if (values.length === 0) return 0;
    return percentile(values, pctl);
  }, [hydrationTimes, pctl]);

  // Pick a representative page load's LoAF entries at the selected percentile
  // We rank page loads by total blocking time and pick the one at pctl
  const aggregatedLoaf = useMemo(() => {
    if (!loafEntries) return [];
    const pageLoads = Object.entries(loafEntries).filter(([, entries]) => entries.length > 0);
    if (pageLoads.length === 0) return [];

    // Rank page loads by total blocking time, pick the one at the selected percentile
    const ranked = pageLoads
      .map(([id, entries]) => ({
        id,
        entries,
        totalBlocking: entries.reduce((sum, e) => sum + e.blockingDuration, 0),
      }))
      .sort((a, b) => a.totalBlocking - b.totalBlocking);

    const idx = Math.min(
      Math.ceil((pctl / 100) * ranked.length) - 1,
      ranked.length - 1,
    );
    return ranked[Math.max(0, idx)].entries;
  }, [loafEntries, pctl]);

  // Aggregate navigation timing across page loads at selected percentile
  const navTiming = useMemo(() => {
    if (!navigationTimings) return null;
    const values = Object.values(navigationTimings);
    if (values.length === 0) return null;
    return {
      domInteractive: percentile(values.map((t) => t.domInteractive), pctl),
      domContentLoaded: percentile(values.map((t) => t.domContentLoaded), pctl),
      loadEvent: percentile(values.map((t) => t.loadEvent), pctl),
      tbt: percentile(values.map((t) => t.tbt), pctl),
      loafCount: percentile(values.map((t) => t.loafCount), pctl),
    };
  }, [navigationTimings, pctl]);

  const { timings, lcpDataReady, lcpRendered, lcpBlocked, shellEnd } =
    useMemo(() => {
      if (ssrBoundaries.length === 0) {
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
      for (const b of ssrBoundaries) {
        const list = byPath.get(b.boundary_path) ?? [];
        list.push(b);
        byPath.set(b.boundary_path, list);
      }

      // Group queries by boundary_path — pick first queryName per boundary
      const queryNameByPath = new Map<string, string>();
      const queryByKey = new Map<string, QueryMetric[]>();
      for (const q of ssrQueries) {
        if (!queryNameByPath.has(q.boundary_path)) {
          queryNameByPath.set(q.boundary_path, q.queryName);
        }
        const key = `${q.boundary_path}:${q.queryName}`;
        const list = queryByKey.get(key) ?? [];
        list.push(q);
        queryByKey.set(key, list);
      }

      // Order boundaries by median wall_start_ms
      const boundaryOrder = [...byPath.keys()].sort((a, b) => {
        const aMedian = median(byPath.get(a)!.map((m) => m.wall_start_ms));
        const bMedian = median(byPath.get(b)!.map((m) => m.wall_start_ms));
        return aMedian - bMedian;
      });

      const timings: BoundaryTiming[] = [];

      for (const path of boundaryOrder) {
        const metrics = byPath.get(path)!;
        const name = path.split(".").pop()!;
        const wallStart = percentile(
          metrics.map((m) => m.wall_start_ms),
          pctl,
        );
        const queryName = queryNameByPath.get(path) ?? "";

        // Use real recorded fetch durations
        const fetchDurations = metrics.map((m) => m.fetch_duration_ms ?? m.render_duration_ms);
        const realFetch = percentile(fetchDurations, pctl);

        // Get query metrics for cache detection
        const qKey = `${path}:${queryName}`;
        const qMetrics = queryByKey.get(qKey) ?? [];
        const isCached =
          qMetrics.length > 0 && qMetrics.every((m) => m.fullyCached);
        const fetchDuration = isCached ? 0 : realFetch;

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
      const layout = timings.find((t) => t.name === "Layout");
      const shellEnd = layout
        ? layout.wallStart + layout.fetchDuration + layout.renderCost
        : 0;

      // LCP boundary — hero image is the true LCP element (largest visible content)
      const hero = timings.find((t) => t.lcpCritical && t.name === "Hero");
      const pdp = timings.find((t) => t.lcpCritical && t.name === "Title");
      const lcpBoundary = hero ?? pdp;
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

      return {
        timings,
        lcpDataReady,
        lcpRendered,
        lcpBlocked,
        shellEnd,
      };
    }, [ssrBoundaries, ssrQueries, pctl]);

  // Compute CSR query timings for visualization
  const csrTimings = useMemo(() => {
    if (csrBoundaries.length === 0) return [];

    const byPath = new Map<string, BoundaryMetric[]>();
    for (const b of csrBoundaries) {
      const list = byPath.get(b.boundary_path) ?? [];
      list.push(b);
      byPath.set(b.boundary_path, list);
    }

    const queryNameByPath = new Map<string, string>();
    for (const q of csrQueries) {
      if (!queryNameByPath.has(q.boundary_path)) {
        queryNameByPath.set(q.boundary_path, q.queryName);
      }
    }

    return [...byPath.keys()]
      .sort((a, b) => {
        const aMedian = median(byPath.get(a)!.map((m) => m.wall_start_ms));
        const bMedian = median(byPath.get(b)!.map((m) => m.wall_start_ms));
        return aMedian - bMedian;
      })
      .map((path) => {
        const metrics = byPath.get(path)!;
        const name = path.split(".").pop()!;
        return {
          name,
          boundaryPath: path,
          wallStart: percentile(
            metrics.map((m) => m.wall_start_ms),
            pctl,
          ),
          fetchDuration: percentile(
            metrics.map((m) => m.fetch_duration_ms ?? m.render_duration_ms),
            pctl,
          ),
          queryName: queryNameByPath.get(path) ?? "",
        };
      });
  }, [csrBoundaries, csrQueries, pctl]);

  // CSR init complete time (latest CSR query end)
  const csrInitComplete = useMemo(() => {
    if (csrTimings.length === 0) return 0;
    return Math.max(
      ...csrTimings.map((t) => t.wallStart + t.fetchDuration),
    );
  }, [csrTimings]);

  // Compute x-axis scale from all percentile-based values
  const maxMs = useMemo(() => {
    if (timings.length === 0) return 1;
    const ssrEnds = timings.map((t) => t.wallStart + t.total);
    const csrMax = hydrationMs > 0
      ? Math.min(csrInitComplete, hydrationMs + 3000)
      : csrInitComplete;
    const loafEnds = aggregatedLoaf.map((e) => e.startTime + e.duration);
    const loafMax = loafEnds.length > 0 ? Math.max(...loafEnds) : 0;
    const totalMs = Math.max(...ssrEnds, lcpRendered, csrMax, loafMax, 1);
    return Math.ceil(totalMs * 1.15);
  }, [timings, lcpRendered, csrInitComplete, hydrationMs, aggregatedLoaf]);

  if (timings.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        No initialization path data available.
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
    <div className="space-y-6 overflow-x-hidden" style={{ minWidth: 0 }}>
      {/* Time axis + marker labels */}
      <div>
        <div className="flex justify-between text-xs text-zinc-600 font-mono">
          <span>0ms</span>
          <span>{Math.round(maxMs / 4)}ms</span>
          <span>{Math.round(maxMs / 2)}ms</span>
          <span>{Math.round((maxMs * 3) / 4)}ms</span>
          <span>{maxMs}ms</span>
        </div>
        <div className="mt-1 space-y-0">
          {lcpDataReady > 0 && (
            <Tooltip content={`LCP data ready at ${lcpDataReady}ms — all data for the LCP boundary has been fetched`}>
              <div className="relative h-4">
                <div
                  className="absolute top-0 flex items-center"
                  style={{ left: `${(lcpDataReady / maxMs) * 100}%` }}
                >
                  <div className="w-px h-3 bg-blue-400" />
                  <span className="text-[10px] text-blue-400 ml-1 font-mono whitespace-nowrap truncate max-w-[140px] md:max-w-[200px]">
                    LCP data @ {lcpDataReady}ms
                  </span>
                </div>
              </div>
            </Tooltip>
          )}
          {lcpRendered > 0 && (
            <Tooltip content={`LCP rendered at ${lcpRendered}ms — LCP boundary HTML serialized and flushed${lcpBlocked > 0 ? ` (blocked ${lcpBlocked}ms waiting for thread)` : ""}`}>
              <div className="relative h-4">
                <div
                  className="absolute top-0 flex items-center"
                  style={{ left: `${(lcpRendered / maxMs) * 100}%` }}
                >
                  <div className="w-px h-3 bg-green-400" />
                  <span className="text-[10px] text-green-400 ml-1 font-mono whitespace-nowrap truncate max-w-[140px] md:max-w-[200px]">
                    LCP render @ {lcpRendered}ms
                    {lcpBlocked > 0 && (
                      <span className="text-amber-400"> (+{lcpBlocked}ms)</span>
                    )}
                  </span>
                </div>
              </div>
            </Tooltip>
          )}
          {hydrationMs > 0 && (
            <Tooltip content={`Hydration at ${Math.round(hydrationMs)}ms — React hydrates the server-rendered HTML and attaches event handlers`}>
              <div className="relative h-4">
                <div
                  className="absolute top-0 flex items-center"
                  style={{ left: `${(hydrationMs / maxMs) * 100}%` }}
                >
                  <div className="w-px h-3 bg-amber-400" />
                  <span className="text-[10px] text-amber-400 ml-1 font-mono whitespace-nowrap truncate max-w-[140px] md:max-w-[200px]">
                    Hydration @ {Math.round(hydrationMs)}ms
                  </span>
                </div>
              </div>
            </Tooltip>
          )}
          {csrInitComplete > 0 && (
            <Tooltip content={`Init complete at ${Math.round(csrInitComplete)}ms — all client-side queries resolved, page fully interactive`}>
              <div className="relative h-4">
                <div
                  className="absolute top-0 flex items-center"
                  style={{ left: `${(csrInitComplete / maxMs) * 100}%` }}
                >
                  <div className="w-px h-3 bg-purple-400" />
                  <span className="text-[10px] text-purple-400 ml-1 font-mono whitespace-nowrap truncate max-w-[140px] md:max-w-[200px]">
                    Init complete @ {Math.round(csrInitComplete)}ms
                  </span>
                </div>
              </div>
            </Tooltip>
          )}
        </div>
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

          <div className="space-y-1.5 relative z-10">
            {timings
              .filter((t) => t.name !== "Layout")
              .map((t) => {
                const leftPct = (t.wallStart / maxMs) * 100;
                const widthPct = Math.max(
                  (t.fetchDuration / maxMs) * 100,
                  t.cached ? 0.8 : 1.5,
                );
                const color = BOUNDARY_COLORS[t.name] ?? "rgb(100, 116, 139)";

                const tooltipLines: TooltipLine[] = t.cached
                  ? [{ label: "Query", value: t.queryName }, { label: "Status", value: "Cached (React cache() dedup)", color: "text-cyan-400" }]
                  : [
                      { label: "Query", value: t.queryName },
                      { label: "Wall start", value: `${t.wallStart}ms` },
                      { label: "Fetch", value: `${t.fetchDuration}ms`, color: "text-zinc-100" },
                      { label: "Render cost", value: `${t.renderCost}ms` },
                      ...(t.blocked > 0 ? [{ label: "Blocked", value: `${t.blocked}ms`, color: "text-amber-400" }] : []),
                      { label: "Total", value: `${t.total}ms`, color: "text-zinc-100" },
                    ];

                return (
                  <Tooltip
                    key={t.boundaryPath}
                    content={<TooltipContent title={t.name} lines={tooltipLines} tag={t.lcpCritical ? "LCP" : undefined} />}
                  >
                    <div className="relative h-7">
                      {/* Query bar (outer) */}
                      <div
                        className={`absolute top-0 h-full rounded flex items-center overflow-hidden cursor-default ${
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
                  </Tooltip>
                );
              })}
          </div>

          {/* Vertical marker lines */}
          {lcpDataReady > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-blue-400/50 z-0"
              style={{ left: `calc(${(lcpDataReady / maxMs) * 100}% + 12px)` }}
            />
          )}
          {lcpRendered > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-green-400/40 z-0"
              style={{ left: `calc(${(lcpRendered / maxMs) * 100}% + 12px)` }}
            />
          )}
          {hydrationMs > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px border-l border-dashed border-amber-400/60 z-0"
              style={{ left: `calc(${(hydrationMs / maxMs) * 100}% + 12px)` }}
            />
          )}
          {csrInitComplete > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-purple-400/40 z-0"
              style={{ left: `calc(${(csrInitComplete / maxMs) * 100}% + 12px)` }}
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

          <div className="relative h-8 z-10">
            {renderBlocks.map((block) => {
              const leftPct = (block.start / maxMs) * 100;
              const widthPct = Math.max((block.duration / maxMs) * 100, 1.5);
              const color = BOUNDARY_COLORS[block.name] ?? "rgb(100, 116, 139)";

              return (
                <Tooltip
                  key={block.name}
                  className={`absolute top-0 h-full cursor-default ${
                    block.lcpCritical ? "ring-1 ring-blue-400 rounded" : ""
                  }`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                  content={
                    <TooltipContent
                      title={block.name}
                      lines={[
                        { label: "Render start", value: `${Math.round(block.start)}ms` },
                        { label: "Render cost", value: `${block.duration}ms`, color: "text-zinc-100" },
                        { label: "Type", value: "Sync (blocks thread)" },
                      ]}
                      tag={block.lcpCritical ? "LCP" : undefined}
                    />
                  }
                >
                  <div
                    className="h-full rounded flex items-center overflow-hidden"
                    style={{ backgroundColor: color }}
                  >
                    <span className="text-xs text-white px-1 truncate font-mono">
                      {block.name} ({block.duration}ms)
                    </span>
                  </div>
                </Tooltip>
              );
            })}
          </div>

          {/* Vertical marker lines */}
          {lcpDataReady > 0 && (
            <div
              className="absolute top-3 bottom-3 w-px bg-blue-400/50 z-0"
              style={{ left: `calc(${(lcpDataReady / maxMs) * 100}% + 12px)` }}
            />
          )}
          {lcpRendered > 0 && (
            <div
              className="absolute top-3 bottom-3 w-px bg-green-400/40 z-0"
              style={{ left: `calc(${(lcpRendered / maxMs) * 100}% + 12px)` }}
            />
          )}
          {hydrationMs > 0 && (
            <div
              className="absolute top-3 bottom-3 w-px border-l border-dashed border-amber-400/60 z-0"
              style={{ left: `calc(${(hydrationMs / maxMs) * 100}% + 12px)` }}
            />
          )}
          {csrInitComplete > 0 && (
            <div
              className="absolute top-3 bottom-3 w-px bg-purple-400/40 z-0"
              style={{ left: `calc(${(csrInitComplete / maxMs) * 100}% + 12px)` }}
            />
          )}
        </div>
      </div>

      {/* CSR Queries timeline */}
      {csrTimings.length > 0 && (
        <div>
          <div className="text-xs text-zinc-400 mb-2 font-medium">
            Client Queries{" "}
            <span className="text-zinc-600">(post-hydration)</span>
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

            <div className="space-y-1.5 relative z-10">
              {csrTimings.map((t) => {
                const leftPct = (t.wallStart / maxMs) * 100;
                const widthPct = Math.max(
                  (t.fetchDuration / maxMs) * 100,
                  1.5,
                );
                const color =
                  BOUNDARY_COLORS[t.name] ?? "rgb(168, 85, 247)";

                return (
                  <Tooltip
                    key={t.boundaryPath}
                    content={
                      <TooltipContent
                        title={t.name}
                        lines={[
                          { label: "Query", value: t.queryName },
                          { label: "Starts at", value: `${Math.round(t.wallStart)}ms` },
                          { label: "Fetch", value: `${t.fetchDuration}ms`, color: "text-zinc-100" },
                        ]}
                        tag="CSR"
                      />
                    }
                  >
                    <div className="relative h-7">
                      <div
                        className="absolute top-0 h-full rounded flex items-center overflow-hidden cursor-default"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          background: `repeating-linear-gradient(
                            135deg,
                            ${color},
                            ${color} 3px,
                            transparent 3px,
                            transparent 6px
                          )`,
                          backgroundColor: color,
                          opacity: 0.85,
                        }}
                      >
                        <span className="text-xs text-white px-1.5 truncate font-mono drop-shadow-sm">
                          {t.name} ({t.fetchDuration}ms)
                        </span>
                      </div>
                    </div>
                  </Tooltip>
                );
              })}
            </div>

            {/* Vertical marker lines */}
            {lcpDataReady > 0 && (
              <div
                className="absolute top-3 bottom-3 w-px bg-blue-400/50 z-0"
                style={{ left: `calc(${(lcpDataReady / maxMs) * 100}% + 12px)` }}
              />
            )}
            {lcpRendered > 0 && (
              <div
                className="absolute top-3 bottom-3 w-px bg-green-400/40 z-0"
                style={{ left: `calc(${(lcpRendered / maxMs) * 100}% + 12px)` }}
              />
            )}
            {hydrationMs > 0 && (
              <div
                className="absolute top-3 bottom-3 w-px border-l border-dashed border-amber-400/60 z-0"
                style={{
                  left: `calc(${(hydrationMs / maxMs) * 100}% + 12px)`,
                }}
              />
            )}
            {csrInitComplete > 0 && (
              <div
                className="absolute top-3 bottom-3 w-px bg-purple-400/40 z-0"
                style={{ left: `calc(${(csrInitComplete / maxMs) * 100}% + 12px)` }}
              />
            )}

          </div>
        </div>
      )}

      {/* Long Animation Frames */}
      <div>
        <div className="text-xs text-zinc-400 mb-2 font-medium">
          Long Animation Frames{" "}
          <span className="text-zinc-600">(client JS &gt;50ms)</span>
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

          {aggregatedLoaf.length > 0 ? (
            <div className="space-y-1.5 relative z-10">
              {aggregatedLoaf.map((entry, i) => {
                const leftPct = (entry.startTime / maxMs) * 100;
                const totalWidthPct = Math.max(
                  (entry.duration / maxMs) * 100,
                  1.5,
                );
                const blockingWidthPct = (entry.blockingDuration / maxMs) * 100;
                const scriptSummary =
                  entry.scripts.length > 0
                    ? entry.scripts
                        .map((s) => {
                          const file = s.sourceURL.split("/").pop() ?? s.sourceURL;
                          return s.sourceFunctionName
                            ? `${s.sourceFunctionName} (${file})`
                            : file;
                        })
                        .join(", ")
                    : "";

                const loafLines: TooltipLine[] = [
                  { label: "Start", value: `${Math.round(entry.startTime)}ms` },
                  { label: "Total duration", value: `${Math.round(entry.duration)}ms` },
                  { label: "Blocking", value: `${Math.round(entry.blockingDuration)}ms`, color: "text-red-400" },
                  ...entry.scripts.map((s) => {
                    const file = s.sourceURL.split("/").pop() ?? s.sourceURL;
                    const fn = s.sourceFunctionName || "(anonymous)";
                    return { label: fn, value: `${file} (${s.duration}ms)`, color: "text-zinc-400" as string };
                  }),
                ];

                return (
                  <Tooltip
                    key={i}
                    content={<TooltipContent title="Long Animation Frame" lines={loafLines} tag="LoAF" />}
                  >
                    <div className="relative h-7">
                      {/* Total duration (dimmer) */}
                      <div
                        className="absolute top-0 h-full rounded overflow-hidden cursor-default"
                        style={{
                          left: `${leftPct}%`,
                          width: `${totalWidthPct}%`,
                          backgroundColor: "rgb(239, 68, 68)",
                          opacity: 0.3,
                        }}
                      />
                      {/* Blocking duration (bright) */}
                      <div
                        className="absolute top-0 h-full rounded flex items-center overflow-hidden cursor-default"
                        style={{
                          left: `${leftPct}%`,
                          width: `${Math.max(blockingWidthPct, 1)}%`,
                          backgroundColor: "rgb(239, 68, 68)",
                          opacity: 0.8,
                        }}
                      >
                        <span className="text-xs text-white px-1.5 truncate font-mono">
                          {Math.round(entry.blockingDuration)}ms blocking
                          {scriptSummary && (
                            <span className="text-red-200 ml-1">
                              {scriptSummary}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <div className="relative h-7 flex items-center">
              <span className="text-xs text-zinc-600 font-mono">
                No long animation frames detected during initialization
              </span>
            </div>
          )}

          {/* Vertical marker lines */}
          {lcpDataReady > 0 && (
            <div
              className="absolute top-3 bottom-3 w-px bg-blue-400/50 z-0"
              style={{ left: `calc(${(lcpDataReady / maxMs) * 100}% + 12px)` }}
            />
          )}
          {lcpRendered > 0 && (
            <div
              className="absolute top-3 bottom-3 w-px bg-green-400/40 z-0"
              style={{ left: `calc(${(lcpRendered / maxMs) * 100}% + 12px)` }}
            />
          )}
          {hydrationMs > 0 && (
            <div
              className="absolute top-3 bottom-3 w-px border-l border-dashed border-amber-400/60 z-0"
              style={{
                left: `calc(${(hydrationMs / maxMs) * 100}% + 12px)`,
              }}
            />
          )}
          {csrInitComplete > 0 && (
            <div
              className="absolute top-3 bottom-3 w-px bg-purple-400/40 z-0"
              style={{ left: `calc(${(csrInitComplete / maxMs) * 100}% + 12px)` }}
            />
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
        <div>
          <span className="text-zinc-500">Layout (waterfall): </span>
          <span className="text-amber-400">
            {timings.find((t) => t.name === "Layout")?.total ?? 0}ms
          </span>
        </div>
        <div>
          <span className="text-zinc-500">Nav render cost: </span>
          <span className="text-orange-400">
            {timings.find((t) => t.name === "Nav")?.renderCost ?? 0}ms
          </span>
        </div>
        <div>
          <span className="text-zinc-500">LCP query: </span>
          <span className="text-zinc-300">
            {timings.find((t) => t.name === "Title")?.fetchDuration ??
              timings.find((t) => t.name === "Hero")?.fetchDuration ??
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
        {hydrationMs > 0 && (
          <div>
            <span className="text-zinc-500">Hydration: </span>
            <span className="text-amber-400">{Math.round(hydrationMs)}ms</span>
          </div>
        )}
        {navTiming && (
          <div>
            <span className="text-zinc-500">DOM Interactive: </span>
            <span className="text-cyan-400">{Math.round(navTiming.domInteractive)}ms</span>
          </div>
        )}
        {navTiming && (
          <div>
            <span className="text-zinc-500">DCL: </span>
            <span className="text-cyan-400">{Math.round(navTiming.domContentLoaded)}ms</span>
          </div>
        )}
        {navTiming && navTiming.loadEvent > 0 && (
          <div>
            <span className="text-zinc-500">Load: </span>
            <span className="text-cyan-400">{Math.round(navTiming.loadEvent)}ms</span>
          </div>
        )}
        {navTiming && (
          <div>
            <span className="text-zinc-500">TBT: </span>
            <span className={`font-medium ${navTiming.tbt > 200 ? "text-red-400" : navTiming.tbt > 50 ? "text-amber-400" : "text-green-400"}`}>
              {Math.round(navTiming.tbt)}ms
            </span>
          </div>
        )}
        <div>
          <span className="text-zinc-500">Long frames: </span>
          <span className="text-red-400">
            {aggregatedLoaf.length > 0
              ? `${aggregatedLoaf.length} (${Math.round(aggregatedLoaf.reduce((sum, e) => sum + e.blockingDuration, 0))}ms blocking)`
              : "0"}
          </span>
        </div>
        {csrInitComplete > 0 && (
          <div>
            <span className="text-zinc-500">CSR init complete: </span>
            <span className="text-purple-400 font-medium">
              {Math.round(csrInitComplete)}ms
            </span>
          </div>
        )}
        {csrInitComplete > 0 && (
          <div>
            <span className="text-zinc-500">Total E2E: </span>
            <span className="text-white font-medium">
              {Math.round(csrInitComplete)}ms
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
