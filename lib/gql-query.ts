import { cache } from "react";
import { getRequestContext } from "./boundary-context";
import { metricsStore } from "./metrics-store";
import { sleep } from "./sleep";
import { GQL_QUERIES, SUBGRAPH_OPERATIONS } from "./gql-federation";

/**
 * Simulates a subgraph operation with realistic latency distribution.
 *
 * Weighted buckets create meaningful p50/p99 separation:
 *  ~70% — tight cluster near baseMs (±10%)
 *  ~20% — moderately slow (1.3–1.8× baseMs)
 *   ~8% — slow (2–3× baseMs)
 *   ~2% — very slow (3–5× baseMs, simulating GC pauses / cold starts)
 */
async function simulateSubgraphOp(baseMs: number): Promise<number> {
  const ctx = getRequestContext();
  const effectiveBase = ctx.slowMode ? baseMs * 20 : baseMs;

  const roll = Math.random();
  let multiplier: number;

  if (roll < 0.85) {
    // Typical — tight ±10% around base
    multiplier = 0.9 + Math.random() * 0.2;
  } else if (roll < 0.96) {
    // Moderately slow
    multiplier = 1.0 + Math.random() * 0.15;
  } else if (roll < 0.995) {
    // Slow
    multiplier = 1.15 + Math.random() * 0.2;
  } else {
    // Tail — GC pause, cold start, etc.
    multiplier = 1.35 + Math.random() * 0.3;
  }

  const actualMs = Math.max(5, Math.round(effectiveBase * multiplier));
  await sleep(actualMs);
  return actualMs;
}

interface OpResult {
  opName: string;
  duration_ms: number;
}

/**
 * Request-scoped tracker for query-level cache dedup detection.
 * Registered synchronously before async work so concurrent Suspense
 * boundaries correctly detect when they share the same query.
 */
const getExecutedTracker = cache(() => new Set<string>());

/**
 * Query-level cache — deduplicates entire queries within the same request.
 * e.g., hero + thumbnails both call getProductMedia — second shares the promise.
 * Cache key is queryName ONLY.
 */
const cachedQueryExec = cache(async (queryName: string): Promise<OpResult[]> => {
  const queryDef = GQL_QUERIES[queryName];
  if (!queryDef) throw new Error(`Unknown GQL query: ${queryName}`);

  const results: OpResult[] = [];

  await Promise.all(
    queryDef.operations.map(async (opName) => {
      const opDef = SUBGRAPH_OPERATIONS[opName];
      if (!opDef) throw new Error(`Unknown subgraph op: ${opName}`);

      const opStart = Date.now();
      await simulateSubgraphOp(opDef.baseMs);
      results.push({ opName, duration_ms: Date.now() - opStart });
    }),
  );

  return results;
});

/**
 * Execute a GQL query with federation simulation and React cache() dedup.
 *
 * Query-level caching: same queryName within the same request shares the
 * same promise. The tracker Set detects this synchronously before any await,
 * so concurrent Suspense siblings correctly identify cache hits.
 */
export async function executeGqlQuery<T>(
  queryName: string,
  boundaryPath: string,
  mockDataFn: () => T,
  route: string = "/products/[sku]",
): Promise<T> {
  const ctx = getRequestContext();
  const queryDef = GQL_QUERIES[queryName];
  if (!queryDef) throw new Error(`Unknown GQL query: ${queryName}`);

  // Synchronous registration before any await — works with concurrent siblings
  const tracker = getExecutedTracker();
  const isQueryCacheHit = tracker.has(queryName);
  tracker.add(queryName);

  const start = Date.now();
  const opResults = await cachedQueryExec(queryName);
  const duration = Date.now() - start;

  if (isQueryCacheHit) {
    // Cache hit — another boundary already claimed this query
    for (const opName of queryDef.operations) {
      const opDef = SUBGRAPH_OPERATIONS[opName];
      metricsStore.recordSubgraphOp({
        timestamp: Date.now(),
        requestId: ctx.requestId,
        route,
        boundary_path: boundaryPath,
        queryName,
        operationName: opName,
        subgraphName: opDef.subgraph,
        duration_ms: 0,
        cached: true,
      });
    }

    metricsStore.recordQuery({
      timestamp: Date.now(),
      requestId: ctx.requestId,
      route,
      boundary_path: boundaryPath,
      queryName,
      duration_ms: 0,
      subgraphOps: queryDef.operations,
      cachedOps: queryDef.operations,
      fullyCached: true,
    });
  } else {
    // First call — record actual timings
    for (const result of opResults) {
      const opDef = SUBGRAPH_OPERATIONS[result.opName];
      metricsStore.recordSubgraphOp({
        timestamp: Date.now(),
        requestId: ctx.requestId,
        route,
        boundary_path: boundaryPath,
        queryName,
        operationName: result.opName,
        subgraphName: opDef.subgraph,
        duration_ms: result.duration_ms,
        cached: false,
      });
    }

    metricsStore.recordQuery({
      timestamp: Date.now(),
      requestId: ctx.requestId,
      route,
      boundary_path: boundaryPath,
      queryName,
      duration_ms: duration,
      subgraphOps: queryDef.operations,
      cachedOps: [],
      fullyCached: false,
    });
  }

  return mockDataFn();
}
