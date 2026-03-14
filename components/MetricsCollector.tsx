"use client";

import { useEffect, useRef } from "react";
import { clientMetricsStore, type LoAFEntry } from "@/lib/client-metrics-store";
import type {
  BoundaryMetric,
  FetchMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "@/lib/metrics-store";

interface Props {
  metrics: {
    boundaries: BoundaryMetric[];
    fetches: FetchMetric[];
    queries: QueryMetric[];
    subgraphOps: SubgraphOperationMetric[];
  };
}

/** How long after mount to observe Long Animation Frames (ms) */
const LOAF_OBSERVE_WINDOW_MS = 5000;

/**
 * Client component that persists server-rendered metrics to localStorage
 * and observes Long Animation Frames + navigation timing during
 * page initialization.
 *
 * Rendered inside MetricsEmbed's Suspense boundary, so it only mounts
 * after all boundaries have been recorded and the data has streamed in.
 * Receives metrics directly as a prop — no DOM querying needed.
 */
export function MetricsCollector({ metrics }: Props) {
  const stored = useRef(false);

  useEffect(() => {
    if (stored.current) return;
    if (!metrics?.boundaries?.length) return;

    // Deduplicate: don't re-store if this request is already recorded
    const requestId = metrics.boundaries[0].requestId;
    const existing = clientMetricsStore.getMetrics();
    if (existing.boundaries.some((b) => b.requestId === requestId)) return;

    clientMetricsStore.addPageLoad(metrics);
    stored.current = true;

    // --- Long Animation Frame observer ---
    const loafEntries: LoAFEntry[] = [];
    let observer: PerformanceObserver | null = null;

    if (typeof PerformanceObserver !== "undefined") {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const loaf = entry as PerformanceEntry & {
              blockingDuration?: number;
              scripts?: ReadonlyArray<{
                sourceURL?: string;
                sourceFunctionName?: string;
                invokerType?: string;
                duration?: number;
              }>;
            };
            loafEntries.push({
              startTime: Math.round(loaf.startTime),
              duration: Math.round(loaf.duration),
              blockingDuration: Math.round(loaf.blockingDuration ?? 0),
              scripts: (loaf.scripts ?? []).map((s) => ({
                sourceURL: s.sourceURL ?? "",
                sourceFunctionName: s.sourceFunctionName ?? "",
                invokerType: s.invokerType ?? "",
                duration: Math.round(s.duration ?? 0),
              })),
            });
          }
        });

        observer.observe({ type: "long-animation-frame", buffered: true });
      } catch {
        // long-animation-frame not supported in this browser
      }
    }

    // --- Capture navigation timing + LoAF after observation window ---
    setTimeout(() => {
      observer?.disconnect();

      // Store LoAF entries
      if (loafEntries.length > 0) {
        clientMetricsStore.appendLoafEntries(requestId, loafEntries);
      }

      // Capture navigation timing
      const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (navEntry) {
        // TBT = sum of (duration - 50ms) for all long frames
        const tbt = loafEntries.reduce(
          (sum, e) => sum + Math.max(0, e.duration - 50),
          0,
        );

        clientMetricsStore.appendNavigationTiming(requestId, {
          domInteractive: Math.round(navEntry.domInteractive),
          domContentLoaded: Math.round(navEntry.domContentLoadedEventEnd),
          loadEvent: Math.round(navEntry.loadEventEnd || navEntry.loadEventStart),
          tbt: Math.round(tbt),
          loafCount: loafEntries.length,
        });
      }
    }, LOAF_OBSERVE_WINDOW_MS);
  }, [metrics]);

  return null;
}
