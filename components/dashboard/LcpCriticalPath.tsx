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

interface WaterfallSegment {
  label: string;
  startMs: number;
  durationMs: number;
  type: "boundary" | "fetch";
}

export function LcpCriticalPath({ boundaries, fetches }: Props) {
  const segments = useMemo(() => {
    if (boundaries.length === 0) return [];

    // LCP critical path: shell (session-config) -> pdp (product-api) -> hero available
    // Get p50 values for the critical path

    // Shell boundary wall_start and duration
    const shellMetrics = boundaries.filter(
      (b) => b.boundary_path === "shell" && b.is_lcp_critical
    );
    const shellFetches = fetches.filter(
      (f) => f.boundary_path === "shell" && f.fetch_name === "session-config"
    );

    // PDP boundary
    const pdpMetrics = boundaries.filter(
      (b) => b.boundary_path === "shell.pdp" && b.is_lcp_critical
    );
    const pdpFetches = fetches.filter(
      (f) => f.boundary_path === "shell.pdp" && f.fetch_name === "product-api"
    );

    const shellDuration = percentile(
      shellFetches.map((f) => f.duration_ms),
      50
    );
    const pdpWallStart = percentile(
      pdpMetrics.map((b) => b.wall_start_ms),
      50
    );
    const pdpFetchDuration = percentile(
      pdpFetches.map((f) => f.duration_ms),
      50
    );

    const result: WaterfallSegment[] = [
      {
        label: "shell await (session-config)",
        startMs: 0,
        durationMs: shellDuration,
        type: "fetch",
      },
      {
        label: "product-api fetch",
        startMs: pdpWallStart,
        durationMs: pdpFetchDuration,
        type: "fetch",
      },
    ];

    return result;
  }, [boundaries, fetches]);

  if (segments.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        No LCP critical path data available.
      </div>
    );
  }

  const totalMs = Math.max(
    ...segments.map((s) => s.startMs + s.durationMs),
    1
  );
  // Add 20% padding
  const maxMs = Math.ceil(totalMs * 1.2);
  const heroAvailableMs = segments[segments.length - 1].startMs + segments[segments.length - 1].durationMs;

  return (
    <div className="space-y-4">
      <div className="text-xs text-zinc-500 mb-2">
        Server-side work that must complete before the hero image is available to
        the browser.
      </div>

      <div className="relative">
        {/* Time axis */}
        <div className="flex justify-between text-xs text-zinc-600 mb-1 font-mono">
          <span>0ms</span>
          <span>{Math.round(maxMs / 4)}ms</span>
          <span>{Math.round(maxMs / 2)}ms</span>
          <span>{Math.round((maxMs * 3) / 4)}ms</span>
          <span>{maxMs}ms</span>
        </div>

        {/* Grid lines */}
        <div className="relative bg-zinc-900 rounded border border-zinc-800 p-4">
          {/* Vertical grid lines */}
          <div className="absolute inset-4 flex justify-between pointer-events-none">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={pct}
                className="w-px bg-zinc-800"
                style={{ height: "100%" }}
              />
            ))}
          </div>

          {/* Segments */}
          <div className="space-y-3 relative">
            {segments.map((seg, i) => {
              const leftPct = (seg.startMs / maxMs) * 100;
              const widthPct = Math.max(
                (seg.durationMs / maxMs) * 100,
                2
              );

              return (
                <div key={i} className="relative h-8">
                  <div
                    className="absolute top-0 h-full rounded flex items-center overflow-hidden"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor:
                        seg.type === "fetch"
                          ? "rgb(59, 130, 246)"
                          : "rgb(99, 102, 241)",
                    }}
                  >
                    <span className="text-xs text-white px-2 truncate font-mono">
                      {seg.label} ({seg.durationMs}ms)
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Hero available marker */}
            <div className="relative h-6">
              <div
                className="absolute top-0 flex items-center"
                style={{ left: `${(heroAvailableMs / maxMs) * 100}%` }}
              >
                <div className="w-px h-6 bg-green-400" />
                <span className="text-xs text-green-400 ml-1 font-mono whitespace-nowrap">
                  hero available @ {heroAvailableMs}ms
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="flex gap-6 text-xs font-mono">
        <div>
          <span className="text-zinc-500">Shell blocking: </span>
          <span className="text-zinc-300">{segments[0]?.durationMs ?? 0}ms</span>
        </div>
        <div>
          <span className="text-zinc-500">Product API: </span>
          <span className="text-zinc-300">{segments[1]?.durationMs ?? 0}ms</span>
        </div>
        <div>
          <span className="text-zinc-500">Total to hero: </span>
          <span className="text-blue-400 font-medium">{heroAvailableMs}ms</span>
        </div>
        <div>
          <span className="text-zinc-500">Then: </span>
          <span className="text-zinc-600">browser image load (not measured)</span>
        </div>
      </div>
    </div>
  );
}
