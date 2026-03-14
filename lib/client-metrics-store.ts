/**
 * Client-side metrics store backed by localStorage.
 *
 * Replaces the server-side in-memory MetricsStore for Vercel compatibility.
 * On Vercel, lambda functions don't share memory, so server-side storage
 * is unreliable. Instead, we simulate load client-side and persist here.
 */

import type {
  BoundaryMetric,
  FetchMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "./metrics-store";

export interface ClientMetrics {
  boundaries: BoundaryMetric[];
  fetches: FetchMetric[];
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  totalPageLoads: number;
}

const STORAGE_KEY = "suspense-dashboard-metrics";
const MAX_PAGE_LOADS = 100;

function loadFromStorage(): ClientMetrics {
  if (typeof window === "undefined") {
    return emptyMetrics();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMetrics();
    const parsed = JSON.parse(raw);
    // Basic validation
    if (parsed && Array.isArray(parsed.boundaries)) {
      return parsed as ClientMetrics;
    }
    return emptyMetrics();
  } catch {
    return emptyMetrics();
  }
}

function saveToStorage(metrics: ClientMetrics) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function emptyMetrics(): ClientMetrics {
  return {
    boundaries: [],
    fetches: [],
    queries: [],
    subgraphOps: [],
    totalPageLoads: 0,
  };
}

/** Count unique request IDs in boundary metrics */
function countPageLoads(boundaries: BoundaryMetric[]): number {
  return new Set(boundaries.map((b) => b.requestId)).size;
}

/**
 * Trim oldest page loads to stay under MAX_PAGE_LOADS.
 */
function trimMetrics(metrics: ClientMetrics): ClientMetrics {
  const requestIds = new Set(metrics.boundaries.map((b) => b.requestId));
  if (requestIds.size <= MAX_PAGE_LOADS) return metrics;

  // Sort by timestamp to find oldest
  const sorted = [...metrics.boundaries].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const idsByAge: string[] = [];
  const seen = new Set<string>();
  for (const m of sorted) {
    if (!seen.has(m.requestId)) {
      seen.add(m.requestId);
      idsByAge.push(m.requestId);
    }
  }

  const toRemove = new Set(
    idsByAge.slice(0, requestIds.size - MAX_PAGE_LOADS),
  );

  const boundaries = metrics.boundaries.filter(
    (m) => !toRemove.has(m.requestId),
  );
  return {
    boundaries,
    fetches: metrics.fetches.filter((m) => !toRemove.has(m.requestId)),
    queries: metrics.queries.filter((m) => !toRemove.has(m.requestId)),
    subgraphOps: metrics.subgraphOps.filter(
      (m) => !toRemove.has(m.requestId),
    ),
    totalPageLoads: countPageLoads(boundaries),
  };
}

export const clientMetricsStore = {
  getMetrics(): ClientMetrics {
    return loadFromStorage();
  },

  /** Append metrics from one simulated page load */
  addPageLoad(page: {
    boundaries: BoundaryMetric[];
    fetches: FetchMetric[];
    queries: QueryMetric[];
    subgraphOps: SubgraphOperationMetric[];
  }) {
    const current = loadFromStorage();
    const merged: ClientMetrics = {
      boundaries: [...current.boundaries, ...page.boundaries],
      fetches: [...current.fetches, ...page.fetches],
      queries: [...current.queries, ...page.queries],
      subgraphOps: [...current.subgraphOps, ...page.subgraphOps],
      totalPageLoads: 0,
    };
    const trimmed = trimMetrics(merged);
    trimmed.totalPageLoads = countPageLoads(trimmed.boundaries);
    saveToStorage(trimmed);
  },

  clear() {
    saveToStorage(emptyMetrics());
  },

  /** How many page loads are currently stored */
  getPageLoadCount(): number {
    return loadFromStorage().totalPageLoads;
  },
};
