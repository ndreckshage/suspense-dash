import { getRequestContext } from "./boundary-context";
import { metricsStore } from "./metrics-store";

/**
 * Instrumented fetch wrapper that measures and records fetch duration.
 * Reads request context from React cache() for requestId and route info.
 */
export async function tracedFetch<T>(
  name: string,
  fn: () => Promise<T>,
  boundaryPath: string,
  route: string = "/products/[sku]"
): Promise<T> {
  const ctx = getRequestContext();
  const start = Date.now();

  const result = await fn();

  const duration = Date.now() - start;

  metricsStore.recordFetch({
    timestamp: Date.now(),
    requestId: ctx.requestId,
    route,
    boundary_path: boundaryPath,
    fetch_name: name,
    duration_ms: duration,
  });

  return result;
}
