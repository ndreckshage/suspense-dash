/**
 * Client-side query simulation engine.
 *
 * Simulates realistic post-hydration GraphQL queries using the same
 * federation definitions and latency distributions as the server-side
 * simulation. Returns metric objects with phase: "csr" that can be
 * merged into the existing metrics pipeline.
 */

import { GQL_QUERIES, SUBGRAPH_OPERATIONS } from "./gql-federation";
import type {
  BoundaryMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "./metrics-store";

/** Max time (ms) after hydration to wait for all init queries */
const CSR_TIMEOUT_MS = 3000;

/**
 * CSR query schedule — defines which queries fire and when (relative to hydration).
 * Stagger pattern: 2 immediate (cart + favorites), 1 deferred (Q&A).
 */
export const CSR_QUERY_SCHEDULE: {
  queryName: string;
  boundaryPath: string;
  delayMs: number;
}[] = [
  { queryName: "getUserCart", boundaryPath: "csr.Cart", delayMs: 0 },
  { queryName: "getUserFavorites", boundaryPath: "csr.Favorites", delayMs: 0 },
  { queryName: "getReviewsQA", boundaryPath: "csr.ReviewsQA", delayMs: 200 },
];

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

/** Sleep utility for client-side use */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CsrSimulationResult {
  boundaries: BoundaryMetric[];
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  hydration_ms: number;
}

/**
 * Run the full CSR query simulation.
 *
 * @param requestId - The SSR request ID to correlate with
 * @param requestStartTs - The original request start timestamp (Date.now() from server)
 * @param hydrationMs - Milliseconds from request start to hydration
 * @returns Metrics for all CSR queries, bounded by CSR_TIMEOUT_MS
 */
export async function simulateCsrQueries(
  requestId: string,
  requestStartTs: number,
  hydrationMs: number,
  onQueryComplete?: (queryName: string) => void,
): Promise<CsrSimulationResult> {
  const boundaries: BoundaryMetric[] = [];
  const queries: QueryMetric[] = [];
  const subgraphOps: SubgraphOperationMetric[] = [];

  const route = "/products/[sku]";

  async function executeQuery(
    queryName: string,
    boundaryPath: string,
    delayMs: number,
  ) {
    // Wait for the stagger delay
    if (delayMs > 0) await sleep(delayMs);

    const queryDef = GQL_QUERIES[queryName];
    if (!queryDef) return;

    // wall_start_ms is relative to the original request start
    const wallStart = hydrationMs + delayMs;
    const queryStart = performance.now();

    // Simulate all subgraph ops in parallel (like the server does)
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

    // Record subgraph op metrics
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

    // Record query metric
    queries.push({
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
    });

    // Record boundary metric (lightweight — no thread blocking on client)
    boundaries.push({
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
    });

    // Notify UI that this query has resolved
    onQueryComplete?.(queryName);
  }

  // Run all queries with a timeout cap
  await Promise.race([
    Promise.all(
      CSR_QUERY_SCHEDULE.map((q) =>
        executeQuery(q.queryName, q.boundaryPath, q.delayMs),
      ),
    ),
    sleep(CSR_TIMEOUT_MS),
  ]);

  return { boundaries, queries, subgraphOps, hydration_ms: hydrationMs };
}
