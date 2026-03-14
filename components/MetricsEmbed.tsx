import { Suspense } from "react";
import { headers } from "next/headers";
import { metricsStore, EXPECTED_BOUNDARY_COUNT } from "@/lib/metrics-store";

interface MetricsEmbedProps {
  requestId: string;
}

/**
 * Server component that embeds per-request metrics in the HTML response.
 *
 * Only activates when the `x-load-test` header is present. Waits for all
 * Suspense boundaries to finish recording metrics, then outputs them as
 * a JSON script tag that the client can extract.
 *
 * Wrapped in its own Suspense boundary so it doesn't block initial HTML.
 * The client fetches the full page response (including streamed chunks)
 * and parses out the metrics.
 */
export function MetricsEmbed({ requestId }: MetricsEmbedProps) {
  return (
    <Suspense fallback={null}>
      <MetricsEmbedInner requestId={requestId} />
    </Suspense>
  );
}

async function MetricsEmbedInner({ requestId }: MetricsEmbedProps) {
  const headersList = await headers();
  const isLoadTest = headersList.get("x-load-test") === "true";
  if (!isLoadTest) return null;

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
