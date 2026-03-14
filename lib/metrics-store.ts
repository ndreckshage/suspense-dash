export interface BoundaryMetric {
  timestamp: number;
  requestId: string;
  route: string;
  boundary_path: string;
  wall_start_ms: number;
  render_duration_ms: number;
  /** Async I/O time — the await render() portion (non-blocking, overlaps with other boundaries) */
  fetch_duration_ms?: number;
  /** Sync CPU time — busy-wait simulating JSX→HTML serialization (blocks the thread) */
  render_cost_ms?: number;
  /** Time this boundary waited for the thread after its fetch resolved (>0 means another boundary's render was blocking) */
  blocked_ms?: number;
  is_lcp_critical: boolean;
  /** "ssr" (default/undefined) or "csr" for client-side queries */
  phase?: "ssr" | "csr";
}

export interface FetchMetric {
  timestamp: number;
  requestId: string;
  route: string;
  boundary_path: string;
  fetch_name: string;
  duration_ms: number;
}

export interface SubgraphOperationMetric {
  timestamp: number;
  requestId: string;
  route: string;
  boundary_path: string;
  queryName: string;
  operationName: string;
  subgraphName: string;
  duration_ms: number;
  cached: boolean;
  /** "ssr" (default/undefined) or "csr" for client-side queries */
  phase?: "ssr" | "csr";
}

export interface QueryMetric {
  timestamp: number;
  requestId: string;
  route: string;
  boundary_path: string;
  queryName: string;
  duration_ms: number;
  subgraphOps: string[];
  cachedOps: string[];
  fullyCached: boolean;
  /** "ssr" (default/undefined) or "csr" for client-side queries */
  phase?: "ssr" | "csr";
}

const MAX_PAGE_LOADS = 200;

/** Number of boundaries the PDP page records per request */
export const EXPECTED_BOUNDARY_COUNT = 14;

class MetricsStore {
  private boundaryMetrics: BoundaryMetric[] = [];
  private fetchMetrics: FetchMetric[] = [];
  private subgraphOpMetrics: SubgraphOperationMetric[] = [];
  private queryMetrics: QueryMetric[] = [];
  private requestIds: Set<string> = new Set();

  recordBoundary(metric: BoundaryMetric) {
    this.requestIds.add(metric.requestId);
    this.boundaryMetrics.push(metric);
    this.trimIfNeeded();
  }

  recordFetch(metric: FetchMetric) {
    this.requestIds.add(metric.requestId);
    this.fetchMetrics.push(metric);
    this.trimIfNeeded();
  }

  recordSubgraphOp(metric: SubgraphOperationMetric) {
    this.requestIds.add(metric.requestId);
    this.subgraphOpMetrics.push(metric);
    this.trimIfNeeded();
  }

  recordQuery(metric: QueryMetric) {
    this.requestIds.add(metric.requestId);
    this.queryMetrics.push(metric);
    this.trimIfNeeded();
  }

  getMetrics() {
    return {
      boundaries: [...this.boundaryMetrics],
      fetches: [...this.fetchMetrics],
      subgraphOps: [...this.subgraphOpMetrics],
      queries: [...this.queryMetrics],
      totalPageLoads: this.requestIds.size,
    };
  }

  clear() {
    this.boundaryMetrics = [];
    this.fetchMetrics = [];
    this.subgraphOpMetrics = [];
    this.queryMetrics = [];
    this.requestIds = new Set();
  }

  /** Get metrics for a single request ID */
  getMetricsForRequest(requestId: string) {
    return {
      boundaries: this.boundaryMetrics.filter((m) => m.requestId === requestId),
      fetches: this.fetchMetrics.filter((m) => m.requestId === requestId),
      subgraphOps: this.subgraphOpMetrics.filter(
        (m) => m.requestId === requestId,
      ),
      queries: this.queryMetrics.filter((m) => m.requestId === requestId),
    };
  }

  /** Wait until a given number of boundaries have been recorded for a request */
  async awaitBoundaryCount(
    requestId: string,
    expectedCount: number,
    timeoutMs: number = 10000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const count = this.boundaryMetrics.filter(
        (m) => m.requestId === requestId,
      ).length;
      if (count >= expectedCount) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  private trimIfNeeded() {
    if (this.requestIds.size <= MAX_PAGE_LOADS) return;

    const sortedBoundaries = this.boundaryMetrics.sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const requestIdsByAge: string[] = [];
    const seen = new Set<string>();
    for (const m of sortedBoundaries) {
      if (!seen.has(m.requestId)) {
        seen.add(m.requestId);
        requestIdsByAge.push(m.requestId);
      }
    }

    const toRemove = new Set(
      requestIdsByAge.slice(0, this.requestIds.size - MAX_PAGE_LOADS)
    );

    this.boundaryMetrics = this.boundaryMetrics.filter(
      (m) => !toRemove.has(m.requestId)
    );
    this.fetchMetrics = this.fetchMetrics.filter(
      (m) => !toRemove.has(m.requestId)
    );
    this.subgraphOpMetrics = this.subgraphOpMetrics.filter(
      (m) => !toRemove.has(m.requestId)
    );
    this.queryMetrics = this.queryMetrics.filter(
      (m) => !toRemove.has(m.requestId)
    );
    for (const id of toRemove) {
      this.requestIds.delete(id);
    }
  }
}

// Singleton via globalThis — ensures the same instance is shared across all
// module evaluations in the same Node.js process (important in dev mode where
// Next.js/Turbopack may re-evaluate modules).
// Version key ensures stale instances (missing new methods) are replaced on hot reload.
const globalKey = "__suspense_metrics_store_v8__" as const;

declare global {
  // eslint-disable-next-line no-var
  var __suspense_metrics_store_v8__: MetricsStore | undefined;
}

export const metricsStore: MetricsStore =
  globalThis[globalKey] ?? (globalThis[globalKey] = new MetricsStore());
