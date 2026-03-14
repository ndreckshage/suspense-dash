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
}

export interface FetchMetric {
  timestamp: number;
  requestId: string;
  route: string;
  boundary_path: string;
  fetch_name: string;
  duration_ms: number;
}

const MAX_PAGE_LOADS = 200;

class MetricsStore {
  private boundaryMetrics: BoundaryMetric[] = [];
  private fetchMetrics: FetchMetric[] = [];
  private requestIds: Set<string> = new Set();

  recordBoundary(metric: BoundaryMetric) {
    this.requestIds.add(metric.requestId);
    this.boundaryMetrics.push(metric);
    this.trimIfNeeded();

    // DATADOG INTEGRATION:
    // Replace this call with:
    //
    // import { metrics } from 'datadog-metrics';
    // metrics.histogram('suspense.boundary.render_ms', metric.render_duration_ms, {
    //   boundary_path: metric.boundary_path,
    //   route: metric.route,
    //   is_lcp_critical: String(metric.is_lcp_critical),
    // });
    //
    // metrics.histogram('suspense.boundary.wall_start_ms', metric.wall_start_ms, {
    //   boundary_path: metric.boundary_path,
    //   route: metric.route,
    // });
    //
    // Dashboard query examples:
    // - p99 by boundary: avg:suspense.boundary.render_ms{route:/products/*}.rollup(p99) by {boundary_path}
    // - LCP critical path: avg:suspense.boundary.render_ms{is_lcp_critical:true,route:/products/*}.rollup(p99) by {boundary_path}
    // - SLO monitor: suspense.boundary.render_ms p99 > threshold by boundary_path
  }

  recordFetch(metric: FetchMetric) {
    this.requestIds.add(metric.requestId);
    this.fetchMetrics.push(metric);
    this.trimIfNeeded();

    // DATADOG INTEGRATION:
    // Replace this call with:
    //
    // import { metrics } from 'datadog-metrics';
    // metrics.histogram('suspense.fetch.duration_ms', metric.duration_ms, {
    //   fetch_name: metric.fetch_name,
    //   boundary_path: metric.boundary_path,
    //   route: metric.route,
    // });
  }

  getMetrics() {
    return {
      boundaries: [...this.boundaryMetrics],
      fetches: [...this.fetchMetrics],
      totalPageLoads: this.requestIds.size,
    };
  }

  clear() {
    this.boundaryMetrics = [];
    this.fetchMetrics = [];
    this.requestIds = new Set();
  }

  private trimIfNeeded() {
    if (this.requestIds.size <= MAX_PAGE_LOADS) return;

    // Find oldest request IDs to remove
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
    for (const id of toRemove) {
      this.requestIds.delete(id);
    }
  }
}

// Singleton via globalThis — ensures the same instance is shared across all
// module evaluations in the same Node.js process (important in dev mode where
// Next.js/Turbopack may re-evaluate modules).
const globalKey = "__suspense_metrics_store__" as const;

declare global {
  // eslint-disable-next-line no-var
  var __suspense_metrics_store__: MetricsStore | undefined;
}

export const metricsStore: MetricsStore =
  globalThis[globalKey] ?? (globalThis[globalKey] = new MetricsStore());
