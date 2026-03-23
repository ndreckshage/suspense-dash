import { describe, it, expect, beforeEach } from "vitest";
import type { BoundaryMetric, FetchMetric, QueryMetric, SubgraphOperationMetric } from "@/lib/metrics-store";

// We need a fresh MetricsStore for each test, but the module exports a singleton.
// Instead, we test the singleton behavior and clear between tests.

function makeBoundaryMetric(overrides: Partial<BoundaryMetric> = {}): BoundaryMetric {
  return {
    timestamp: Date.now(),
    requestId: "req-1",
    route: "/products/[sku]",
    boundary_path: "Layout",
    wall_start_ms: 0,
    render_duration_ms: 10,
    is_lcp_critical: false,
    ...overrides,
  };
}

function makeQueryMetric(overrides: Partial<QueryMetric> = {}): QueryMetric {
  return {
    timestamp: Date.now(),
    requestId: "req-1",
    route: "/products/[sku]",
    boundary_path: "Layout",
    queryName: "getNavigation",
    duration_ms: 50,
    subgraphOps: ["cms.navigation"],
    cachedOps: [],
    fullyCached: false,
    ...overrides,
  };
}

function makeSubgraphOpMetric(overrides: Partial<SubgraphOperationMetric> = {}): SubgraphOperationMetric {
  return {
    timestamp: Date.now(),
    requestId: "req-1",
    route: "/products/[sku]",
    boundary_path: "Layout",
    queryName: "getNavigation",
    operationName: "cms.navigation",
    subgraphName: "cms-subgraph",
    duration_ms: 50,
    cached: false,
    ...overrides,
  };
}

describe("MetricsStore", () => {
  let store: typeof import("@/lib/metrics-store").metricsStore;

  beforeEach(async () => {
    const mod = await import("@/lib/metrics-store");
    store = mod.metricsStore;
    store.clear();
  });

  it("starts empty after clear", () => {
    const metrics = store.getMetrics();
    expect(metrics.boundaries).toHaveLength(0);
    expect(metrics.fetches).toHaveLength(0);
    expect(metrics.queries).toHaveLength(0);
    expect(metrics.subgraphOps).toHaveLength(0);
    expect(metrics.totalPageLoads).toBe(0);
  });

  it("records boundary metrics", () => {
    store.recordBoundary(makeBoundaryMetric());
    const metrics = store.getMetrics();
    expect(metrics.boundaries).toHaveLength(1);
    expect(metrics.totalPageLoads).toBe(1);
  });

  it("records fetch metrics", () => {
    const fetch: FetchMetric = {
      timestamp: Date.now(),
      requestId: "req-1",
      route: "/products/[sku]",
      boundary_path: "Layout",
      fetch_name: "getNavigation",
      duration_ms: 50,
    };
    store.recordFetch(fetch);
    expect(store.getMetrics().fetches).toHaveLength(1);
  });

  it("records query and subgraph op metrics", () => {
    store.recordQuery(makeQueryMetric());
    store.recordSubgraphOp(makeSubgraphOpMetric());
    const metrics = store.getMetrics();
    expect(metrics.queries).toHaveLength(1);
    expect(metrics.subgraphOps).toHaveLength(1);
  });

  it("tracks unique request IDs for page load count", () => {
    store.recordBoundary(makeBoundaryMetric({ requestId: "r1" }));
    store.recordBoundary(makeBoundaryMetric({ requestId: "r1" }));
    store.recordBoundary(makeBoundaryMetric({ requestId: "r2" }));
    expect(store.getMetrics().totalPageLoads).toBe(2);
  });

  it("returns metrics for a specific request ID", () => {
    store.recordBoundary(makeBoundaryMetric({ requestId: "r1", boundary_path: "A" }));
    store.recordBoundary(makeBoundaryMetric({ requestId: "r2", boundary_path: "B" }));
    store.recordQuery(makeQueryMetric({ requestId: "r1" }));

    const r1 = store.getMetricsForRequest("r1");
    expect(r1.boundaries).toHaveLength(1);
    expect(r1.boundaries[0].boundary_path).toBe("A");
    expect(r1.queries).toHaveLength(1);

    const r2 = store.getMetricsForRequest("r2");
    expect(r2.boundaries).toHaveLength(1);
    expect(r2.boundaries[0].boundary_path).toBe("B");
    expect(r2.queries).toHaveLength(0);
  });

  it("returns copies from getMetrics (not internal arrays)", () => {
    store.recordBoundary(makeBoundaryMetric());
    const m1 = store.getMetrics();
    const m2 = store.getMetrics();
    expect(m1.boundaries).not.toBe(m2.boundaries);
    expect(m1.boundaries).toEqual(m2.boundaries);
  });

  it("trims oldest page loads when exceeding MAX_PAGE_LOADS (200)", () => {
    // Record 201 unique request IDs
    for (let i = 0; i < 201; i++) {
      store.recordBoundary(makeBoundaryMetric({
        requestId: `req-${i}`,
        timestamp: i,
      }));
    }
    const metrics = store.getMetrics();
    expect(metrics.totalPageLoads).toBe(200);
    // The oldest request (req-0) should have been trimmed
    expect(metrics.boundaries.find((b) => b.requestId === "req-0")).toBeUndefined();
    // The newest should remain
    expect(metrics.boundaries.find((b) => b.requestId === "req-200")).toBeDefined();
  });
});
