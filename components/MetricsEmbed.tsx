import { Suspense } from "react";
import { metricsStore, EXPECTED_BOUNDARY_COUNT } from "@/lib/metrics-store";

interface MetricsEmbedProps {
  requestId: string;
}

/**
 * Server component that embeds per-request metrics in the HTML response.
 *
 * Waits for all Suspense boundaries to finish recording metrics, then outputs
 * them as a JSON script tag. A companion client component (MetricsCollector)
 * reads the tag on hydration and persists to localStorage.
 *
 * Wrapped in its own Suspense boundary so it doesn't block initial HTML —
 * it streams in after all other boundaries have completed.
 */
export function MetricsEmbed({ requestId }: MetricsEmbedProps) {
  return (
    <Suspense fallback={null}>
      <MetricsEmbedInner requestId={requestId} />
    </Suspense>
  );
}

async function MetricsEmbedInner({ requestId }: MetricsEmbedProps) {
  // Wait for all boundaries to finish recording
  await metricsStore.awaitBoundaryCount(
    requestId,
    EXPECTED_BOUNDARY_COUNT,
    10000,
  );

  const metrics = metricsStore.getMetricsForRequest(requestId);

  return (
    <script
      type="application/json"
      id="__perf_metrics__"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(metrics) }}
    />
  );
}
