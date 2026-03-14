"use client";

import { useEffect, useRef } from "react";
import { clientMetricsStore } from "@/lib/client-metrics-store";
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

/**
 * Client component that persists server-rendered metrics to localStorage.
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
  }, [metrics]);

  return null;
}
