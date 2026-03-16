/**
 * Client-side metrics store backed by localStorage.
 *
 * Replaces the server-side in-memory MetricsStore for Vercel compatibility.
 * On Vercel, lambda functions don't share memory, so server-side storage
 * is unreliable. Instead, metrics are embedded in each page response and
 * collected client-side here.
 */

import type {
  BoundaryMetric,
  FetchMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "./metrics-store";

/** A single Long Animation Frame entry captured during page initialization */
export interface LoAFEntry {
  startTime: number;
  duration: number;
  blockingDuration: number;
  scripts: {
    sourceURL: string;
    sourceFunctionName: string;
    invokerType: string;
    duration: number;
  }[];
}

/** Navigation timing snapshot captured during page initialization */
export interface NavigationTiming {
  domInteractive: number;
  domContentLoaded: number;
  loadEvent: number;
  /** Total Blocking Time: sum of (duration - 50ms) for all long animation frames */
  tbt: number;
  /** Total number of long animation frames observed */
  loafCount: number;
}

export interface ClientMetrics {
  boundaries: BoundaryMetric[];
  fetches: FetchMetric[];
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  totalPageLoads: number;
  /** Per-request hydration offsets (ms from request start to hydration) */
  hydrationTimes?: Record<string, number>;
  /** Long Animation Frame entries per requestId */
  loafEntries?: Record<string, LoAFEntry[]>;
  /** Navigation timing per requestId */
  navigationTimings?: Record<string, NavigationTiming>;
}

/**
 * Schema version — bump this when the metric shape changes to avoid
 * deserializing stale data from a previous deploy.
 */
const SCHEMA_VERSION = 2;
const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT ?? "dev";
const STORAGE_KEY = `suspense-dashboard-metrics-v${SCHEMA_VERSION}-${GIT_COMMIT}`;
const SEEDED_KEY = `suspense-dashboard-seeded-${GIT_COMMIT}`;
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

  // Filter keyed-by-requestId maps, preserving entries for surviving page loads
  const filterByRequestId = <T,>(
    map: Record<string, T> | undefined,
  ): Record<string, T> | undefined => {
    if (!map) return undefined;
    const filtered: Record<string, T> = {};
    for (const [id, value] of Object.entries(map)) {
      if (!toRemove.has(id)) filtered[id] = value;
    }
    return Object.keys(filtered).length > 0 ? filtered : undefined;
  };

  return {
    boundaries,
    fetches: metrics.fetches.filter((m) => !toRemove.has(m.requestId)),
    queries: metrics.queries.filter((m) => !toRemove.has(m.requestId)),
    subgraphOps: metrics.subgraphOps.filter(
      (m) => !toRemove.has(m.requestId),
    ),
    totalPageLoads: countPageLoads(boundaries),
    loafEntries: filterByRequestId(metrics.loafEntries),
    navigationTimings: filterByRequestId(metrics.navigationTimings),
    hydrationTimes: filterByRequestId(metrics.hydrationTimes),
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
      ...current,
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

  /** Append CSR metrics to an existing page load by requestId */
  appendCsrMetrics(
    requestId: string,
    csrData: {
      boundaries: BoundaryMetric[];
      queries: QueryMetric[];
      subgraphOps: SubgraphOperationMetric[];
      hydration_ms: number;
    },
  ) {
    const current = loadFromStorage();
    // Only append if this request exists in stored data
    if (!current.boundaries.some((b) => b.requestId === requestId)) return;

    const merged: ClientMetrics = {
      ...current,
      boundaries: [...current.boundaries, ...csrData.boundaries],
      queries: [...current.queries, ...csrData.queries],
      subgraphOps: [...current.subgraphOps, ...csrData.subgraphOps],
      hydrationTimes: {
        ...current.hydrationTimes,
        [requestId]: csrData.hydration_ms,
      },
    };
    saveToStorage(merged);
  },

  /** Append Long Animation Frame entries for a page load */
  appendLoafEntries(requestId: string, entries: LoAFEntry[]) {
    if (entries.length === 0) return;
    const current = loadFromStorage();
    if (!current.boundaries.some((b) => b.requestId === requestId)) return;
    const merged: ClientMetrics = {
      ...current,
      loafEntries: {
        ...current.loafEntries,
        [requestId]: [...(current.loafEntries?.[requestId] ?? []), ...entries],
      },
    };
    saveToStorage(merged);
  },

  /** Store navigation timing for a page load */
  appendNavigationTiming(requestId: string, timing: NavigationTiming) {
    const current = loadFromStorage();
    if (!current.boundaries.some((b) => b.requestId === requestId)) return;
    const merged: ClientMetrics = {
      ...current,
      navigationTimings: {
        ...current.navigationTimings,
        [requestId]: timing,
      },
    };
    saveToStorage(merged);
  },

  /** Replace all stored metrics with the provided data (used by YAML import) */
  loadMetrics(data: ClientMetrics) {
    saveToStorage(data);
    try { localStorage.setItem(SEEDED_KEY, "1"); } catch {}
  },

  clear() {
    saveToStorage(emptyMetrics());
    // Mark that user has seen the dashboard — don't auto-seed again
    try { localStorage.setItem(SEEDED_KEY, "1"); } catch {}
  },

  /** How many page loads are currently stored */
  getPageLoadCount(): number {
    return loadFromStorage().totalPageLoads;
  },

  /** Fetch seed data from /seed-metrics.json and populate localStorage */
  async loadSeedData(): Promise<boolean> {
    if (typeof window === "undefined") return false;

    try {
      const res = await fetch("/seed-metrics.json");
      if (!res.ok) return false;
      const seed = await res.json();
      if (seed && Array.isArray(seed.boundaries) && seed.boundaries.length > 0) {
        seed.totalPageLoads = countPageLoads(seed.boundaries);
        saveToStorage(seed as ClientMetrics);
        try { localStorage.setItem(SEEDED_KEY, "1"); } catch {}
        return true;
      }
    } catch {
      // Seed file unavailable
    }
    return false;
  },

  /**
   * Auto-seed on very first visit (no seeded flag and no data).
   * Returns true if seeding occurred.
   */
  async seedIfFirstVisit(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    // If we've ever seeded or user has cleared, don't auto-seed
    try {
      if (localStorage.getItem(SEEDED_KEY)) return false;
    } catch { return false; }

    const current = loadFromStorage();
    if (current.totalPageLoads > 0 || current.boundaries.length > 0) return false;

    return this.loadSeedData();
  },
};
