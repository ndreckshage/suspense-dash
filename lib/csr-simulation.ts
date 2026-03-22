/**
 * Client-side query simulation engine.
 *
 * Provides a hook for individual components to simulate their own
 * post-hydration GraphQL query, recording metrics for the dashboard.
 * Each component triggers its own simulation in useEffect, which
 * naturally avoids hydration mismatches since effects only fire
 * after the component has hydrated.
 */

import { useState, useEffect, useRef } from "react";
import { GQL_QUERIES, SUBGRAPH_OPERATIONS } from "./gql-federation";
import { clientMetricsStore } from "./client-metrics-store";
import type {
  BoundaryMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "./metrics-store";

/**
 * Simulates subgraph operation latency with the same distribution as the
 * server-side simulateSubgraphOp in gql-query.ts.
 */
function simulateLatencyMs(baseMs: number): number {
  const roll = Math.random();
  let multiplier: number;

  if (roll < 0.85) {
    multiplier = 0.9 + Math.random() * 0.2;
  } else if (roll < 0.96) {
    multiplier = 1.0 + Math.random() * 0.15;
  } else if (roll < 0.995) {
    multiplier = 1.15 + Math.random() * 0.2;
  } else {
    multiplier = 1.35 + Math.random() * 0.3;
  }

  return Math.max(5, Math.round(baseMs * multiplier));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hook that simulates a CSR GraphQL query for a component.
 *
 * Returns "pending" until the simulated query completes, then "complete".
 * Records metrics (boundary, query, subgraph ops) to the client metrics store.
 *
 * @param queryName - The GQL query name (must exist in GQL_QUERIES)
 * @param boundaryPath - The boundary path for metrics (e.g. "Layout.Nav.CartIndicator")
 * @param requestId - The SSR request ID to correlate with
 * @param requestStartTs - The original request start timestamp
 * @param delayMs - Optional delay before firing the query (default 0)
 */
export function useCsrQuerySimulation(
  queryName: string,
  boundaryPath: string,
  requestId: string,
  requestStartTs: number,
  delayMs: number = 0,
): "pending" | "complete" {
  const [status, setStatus] = useState<"pending" | "complete">("pending");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const queryDef = GQL_QUERIES[queryName];
    if (!queryDef) {
      setStatus("complete");
      return;
    }

    const route = "/products/[sku]";
    const hydrationMs = Date.now() - requestStartTs;
    const wallStart = hydrationMs + delayMs;

    (async () => {
      if (delayMs > 0) await sleep(delayMs);

      const queryStart = performance.now();

      const opResults = await Promise.all(
        queryDef.operations.map(async (opName) => {
          const opDef = SUBGRAPH_OPERATIONS[opName];
          if (!opDef) return null;

          const latency = simulateLatencyMs(opDef.baseMs);
          await sleep(latency);

          return {
            opName,
            duration_ms: latency,
            subgraphName: opDef.subgraph,
          };
        }),
      );

      const queryDuration = Math.round(performance.now() - queryStart);

      // Record metrics
      const subgraphOps: SubgraphOperationMetric[] = [];
      for (const result of opResults) {
        if (!result) continue;
        subgraphOps.push({
          timestamp: Date.now(),
          requestId,
          route,
          boundary_path: boundaryPath,
          queryName,
          operationName: result.opName,
          subgraphName: result.subgraphName,
          duration_ms: result.duration_ms,
          cached: false,
          phase: "csr",
        });
      }

      const queries: QueryMetric[] = [{
        timestamp: Date.now(),
        requestId,
        route,
        boundary_path: boundaryPath,
        queryName,
        duration_ms: queryDuration,
        subgraphOps: queryDef.operations,
        cachedOps: [],
        fullyCached: false,
        phase: "csr",
      }];

      const boundaries: BoundaryMetric[] = [{
        timestamp: Date.now(),
        requestId,
        route,
        boundary_path: boundaryPath,
        wall_start_ms: wallStart,
        render_duration_ms: queryDuration,
        fetch_duration_ms: queryDuration,
        render_cost_ms: 0,
        blocked_ms: 0,
        is_lcp_critical: false,
        phase: "csr",
      }];

      clientMetricsStore.appendCsrMetrics(requestId, {
        boundaries,
        queries,
        subgraphOps,
        hydration_ms: hydrationMs,
      });

      setStatus("complete");
    })();
  }, [queryName, boundaryPath, requestId, requestStartTs, delayMs]);

  return status;
}
