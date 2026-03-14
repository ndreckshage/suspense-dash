"use client";

import { useEffect } from "react";
import { clientMetricsStore } from "@/lib/client-metrics-store";

/**
 * Client component that reads embedded metrics from the server-rendered HTML
 * and persists them to localStorage on hydration.
 *
 * The server's MetricsEmbed component writes a <script type="application/json">
 * tag with the request's metrics. This component finds that tag in the DOM,
 * parses it, and stores the data — so every normal page visit automatically
 * contributes to the dashboard's dataset.
 */
export function MetricsCollector() {
  useEffect(() => {
    try {
      const el = document.getElementById("__perf_metrics__");
      if (!el) return;

      const metrics = JSON.parse(el.textContent || "");
      if (!metrics?.boundaries?.length) return;

      // Deduplicate: don't re-store if this request is already recorded
      const requestId = metrics.boundaries[0].requestId;
      const existing = clientMetricsStore.getMetrics();
      const alreadyStored = existing.boundaries.some(
        (b) => b.requestId === requestId,
      );
      if (alreadyStored) return;

      clientMetricsStore.addPageLoad(metrics);
    } catch {
      // Silently ignore — metrics collection is best-effort
    }
  }, []);

  return null;
}
