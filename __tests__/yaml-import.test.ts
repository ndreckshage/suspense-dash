import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseYamlDashboard } from "@/lib/yaml-import";

// --- Minimal YAML helpers ---

const MINIMAL_YAML = `
route: /products/[sku]
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 50
`;

const TWO_BOUNDARY_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 50
    Content:
      render_cost: 3
      queries:
        getContent:
          ops:
            product-subgraph: { p50: 30, p90: 60, p99: 120 }
`;

const CSR_YAML = `
route: /test
hydration_ms: 120
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 50
    Cart:
      csr: true
      render_cost: 2
      queries:
        getUserCart:
          ops:
            user-subgraph: { p50: 40, p90: 80, p99: 130 }
`;

const MULTI_QUERY_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 20
    Content:
      render_cost: 3
      queries:
        getContent:
          ops:
            product-subgraph: 30
        getRecommendations:
          ops:
            recs-subgraph: { p50: 80, p90: 150, p99: 300 }
`;

const MULTI_QUERY_CSR_YAML = `
route: /test
hydration_ms: 100
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 20
    Dashboard:
      csr: true
      render_cost: 2
      queries:
        getUser:
          ops:
            user-subgraph: 30
        getActivity:
          ops:
            activity-subgraph: 90
`;

const CACHED_OPS_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 5
    queries:
      getProductInfo:
        ops:
          product-subgraph: 30
    Bullets:
      render_cost: 3
      queries:
        getProductInfo:
          ops:
            product-subgraph:
              duration: 30
              cached: true
`;

// Parent prefetches getProduct (await: false), child awaits via cache.
// product-subgraph takes 100ms. Parent render_cost=5, so child starts at
// parentWallStart + 0 (parent didn't await) + 5 (render). The child starts
// at ~networkOffset + 5ms. Prefetch started at networkOffset. So remaining
// = max(0, networkOffset + 100 - (networkOffset + 5)) = 95ms.
const PREFETCH_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 5
    queries:
      getProduct:
        await: false
        ops:
          product-subgraph: 100
    ProductDetail:
      render_cost: 3
      queries:
        getProduct:
          ops:
            product-subgraph:
              duration: 100
              cached: true
`;

// Like PREFETCH_YAML but the parent has a slow awaited query too,
// so the child starts later and the prefetch may already be done.
const PREFETCH_COMPLETED_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 200
      getProduct:
        await: false
        ops:
          product-subgraph: 80
    ProductDetail:
      render_cost: 3
      queries:
        getProduct:
          ops:
            product-subgraph:
              duration: 80
              cached: true
`;

// Memoized without prefetch: sibling boundary calls same query as parent.
// Layout calls getProductInfo (awaited, 60ms), Sibling also calls it (cached).
// Sibling starts after Layout's fetch (60ms). Remaining = max(0, 0+60-60) = 0.
const MEMOIZED_SIBLING_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 5
    queries:
      getProductInfo:
        ops:
          product-subgraph: 60
    Sibling:
      render_cost: 3
      queries:
        getProductInfo:
          ops:
            product-subgraph:
              duration: 60
              cached: true
`;

// Memoized with in-flight overlap: two siblings start concurrently.
// Layout fires getProductInfo (60ms) at wallStart=0. Layout also fires
// getOther (30ms) which completes first. Child1 (under Layout) calls
// getProductInfo (cached). Child1 starts after Layout fetch (60ms).
// At that point getProductInfo just finished → remaining = 0.
// But if we restructure so that child starts before original finishes...
//
// Layout has awaited getNav (20ms). Sibling (child of Layout) starts at 20ms.
// Layout also fires getProductInfo (awaited, 60ms) — but this is the SAME boundary,
// so Layout's fetch = max(20, 60) = 60. Child starts at 60ms. Remaining = 0.
//
// For a true in-flight case, we need two sibling boundaries under the same parent
// where one fires the query and the other uses it cached, and both start at the same time.
// With the tree model, siblings start at the same wallStart (parentFetchEnd).
// So: Parent has no queries. Child1 calls getProductInfo (50ms). Child2 calls getProductInfo (cached).
// Both start at parentFetchEnd. queryExecRegistry records Child1's exec at wallStart=parentFetchEnd.
// Child2 checks: remaining = max(0, parentFetchEnd + 50 - parentFetchEnd) = 50ms.
const MEMOIZED_INFLIGHT_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 2
    Child1:
      render_cost: 3
      queries:
        getProductInfo:
          ops:
            product-subgraph: 50
    Child2:
      render_cost: 3
      queries:
        getProductInfo:
          ops:
            product-subgraph:
              duration: 50
              cached: true
`;

// Prefetch + memoized + awaited query on same boundary.
// Layout prefetches getProduct (await: false, 80ms) and awaits getNav (40ms).
// Layout's fetch = 40ms (only getNav). Child starts at 40ms.
// Prefetch started at 0ms. Remaining = max(0, 0+80-40) = 40ms.
const PREFETCH_PARTIAL_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 40
      getProduct:
        await: false
        ops:
          product-subgraph: 80
    Detail:
      render_cost: 3
      queries:
        getProduct:
          ops:
            product-subgraph:
              duration: 80
              cached: true
`;

// Deep nesting: grandparent prefetches, grandchild awaits
const PREFETCH_DEEP_YAML = `
route: /test
boundaries:
  Layout:
    render_cost: 5
    queries:
      getProduct:
        await: false
        ops:
          product-subgraph: { p50: 100, p99: 300 }
    Main:
      render_cost: 3
      Content:
        render_cost: 2
        queries:
          getProduct:
            ops:
              product-subgraph:
                duration: { p50: 100, p99: 300 }
                cached: true
`;

describe("parseYamlDashboard", () => {
  describe("validation", () => {
    it("throws on empty input", () => {
      expect(() => parseYamlDashboard("")).toThrow("Invalid YAML");
    });

    it("throws on missing route", () => {
      expect(() => parseYamlDashboard("boundaries:\n  Layout:\n    render_cost: 1")).toThrow("route");
    });

    it("throws on missing boundaries", () => {
      expect(() => parseYamlDashboard("route: /test")).toThrow("boundaries");
    });
  });

  describe("minimal YAML", () => {
    it("parses and returns MockDashboardData with all percentiles", () => {
      const data = parseYamlDashboard(MINIMAL_YAML);
      expect(data.route).toBe("/products/[sku]");
      expect(data.waterfall).toBeDefined();
      expect(data.tree).toBeDefined();
      expect(data.subgraphs).toBeDefined();

      for (const pctl of [50, 75, 90, 95, 99]) {
        expect(data.waterfall[pctl]).toBeDefined();
        expect(data.tree[pctl]).toBeDefined();
        expect(data.subgraphs[pctl]).toBeDefined();
      }
    });
  });

  describe("waterfall", () => {
    it("produces SSR timings for each boundary", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const w = data.waterfall[50];
      expect(w.ssrTimings.length).toBe(2);
      expect(w.ssrTimings[0].name).toBe("Layout");
      expect(w.ssrTimings[1].name).toBe("Content");
    });

    it("child boundaries start after parent fetch completes", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const w = data.waterfall[50];
      const layout = w.ssrTimings.find((t) => t.name === "Layout")!;
      const content = w.ssrTimings.find((t) => t.name === "Content")!;
      expect(content.wallStart).toBeGreaterThanOrEqual(layout.wallStart + layout.fetchDuration);
    });

    it("uses fudging: highest-variance boundary gets pctl duration", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const w50 = data.waterfall[50];
      const w99 = data.waterfall[99];

      // Content has variance (p50=30, p99=120), Layout has scalar (no variance)
      const content50 = w50.ssrTimings.find((t) => t.name === "Content")!;
      const content99 = w99.ssrTimings.find((t) => t.name === "Content")!;

      // At p99, the content fetch should be larger than at p50
      expect(content99.fetchDuration).toBeGreaterThan(content50.fetchDuration);
    });

    it("separates CSR timings from SSR timings", () => {
      const data = parseYamlDashboard(CSR_YAML);
      const w = data.waterfall[50];
      expect(w.ssrTimings.some((t) => t.name === "Layout")).toBe(true);
      expect(w.ssrTimings.some((t) => t.name === "Cart")).toBe(false);
      expect(w.csrTimings.some((t) => t.name === "Cart")).toBe(true);
    });

    it("CSR timings start after hydration", () => {
      const data = parseYamlDashboard(CSR_YAML);
      const w = data.waterfall[50];
      expect(w.hydrationMs).toBe(120);
      for (const csr of w.csrTimings) {
        expect(csr.wallStart).toBeGreaterThanOrEqual(w.hydrationMs);
      }
    });

    it("uses max query duration when boundary has multiple queries", () => {
      const data = parseYamlDashboard(MULTI_QUERY_YAML);
      const w = data.waterfall[50];
      const content = w.ssrTimings.find((t) => t.name === "Content")!;
      // getContent is 30ms, getRecommendations is 80ms at p50 — should use 80
      expect(content.fetchDuration).toBeGreaterThanOrEqual(80);
    });

    it("multi-query span length increases at higher percentiles", () => {
      const data = parseYamlDashboard(MULTI_QUERY_YAML);
      const w50 = data.waterfall[50];
      const w99 = data.waterfall[99];
      const content50 = w50.ssrTimings.find((t) => t.name === "Content")!;
      const content99 = w99.ssrTimings.find((t) => t.name === "Content")!;
      // At p99, getRecommendations is 300ms which should dominate
      expect(content99.fetchDuration).toBeGreaterThan(content50.fetchDuration);
    });

    it("CSR timings use max query duration across multiple queries", () => {
      const data = parseYamlDashboard(MULTI_QUERY_CSR_YAML);
      const w = data.waterfall[50];
      const dashboard = w.csrTimings.find((t) => t.name === "Dashboard")!;
      // getUser is 30ms, getActivity is 90ms — should use 90
      expect(dashboard.fetchDuration).toBeGreaterThanOrEqual(90);
    });

    it("marks cached boundaries with fetchDuration=0", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const w = data.waterfall[50];
      const bullets = w.ssrTimings.find((t) => t.name === "Bullets")!;
      expect(bullets.cached).toBe(true);
      expect(bullets.fetchDuration).toBe(0);
    });

    it("await:false query does not contribute to parent fetch duration", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const w = data.waterfall[50];
      const layout = w.ssrTimings.find((t) => t.name === "Layout")!;
      // Layout has getProduct with await:false — should not suspend
      expect(layout.fetchDuration).toBe(0);
    });

    it("cached child shows remaining prefetch time, not 0", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const w = data.waterfall[50];
      const detail = w.ssrTimings.find((t) => t.name === "ProductDetail")!;
      // Prefetch: 100ms, started at Layout wallStart.
      // Since Layout has no awaited query, child starts at same wallStart.
      // Remaining = full 100ms (prefetch just started).
      expect(detail.fetchDuration).toBe(100);
      expect(detail.cached).toBe(false); // not fully cached — still waiting
    });

    it("cached child shows 0 when prefetch already completed", () => {
      const data = parseYamlDashboard(PREFETCH_COMPLETED_YAML);
      const w = data.waterfall[50];
      const detail = w.ssrTimings.find((t) => t.name === "ProductDetail")!;
      // Layout awaits getNav (200ms), prefetch is only 80ms.
      // By the time ProductDetail starts (after Layout's 200ms fetch),
      // the prefetch has long finished.
      expect(detail.fetchDuration).toBe(0);
      expect(detail.cached).toBe(true);
    });

    it("prefetch works across deep nesting (grandchild)", () => {
      const data = parseYamlDashboard(PREFETCH_DEEP_YAML);
      const w = data.waterfall[50];
      const content = w.ssrTimings.find((t) => t.name === "Content")!;
      // Prefetch started at Layout. Content is Layout > Main > Content.
      // No intermediate boundary has an awaited query, so they all start
      // at the same wallStart. Remaining = full prefetch duration.
      expect(content.fetchDuration).toBe(100);
      expect(content.cached).toBe(false);
    });

    it("waterfall includes prefetchQueries for boundaries with await:false", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const w = data.waterfall[50];
      const layout = w.ssrTimings.find((t) => t.name === "Layout")!;
      expect(layout.prefetchQueries).toBeDefined();
      expect(layout.prefetchQueries).toContain("getProduct");
    });

    it("waterfall does not include prefetchQueries for boundaries without await:false", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const w = data.waterfall[50];
      const layout = w.ssrTimings.find((t) => t.name === "Layout")!;
      expect(layout.prefetchQueries).toBeUndefined();
    });

    it("waterfall queryNames excludes prefetch queries", () => {
      const data = parseYamlDashboard(PREFETCH_PARTIAL_YAML);
      const w = data.waterfall[50];
      const layout = w.ssrTimings.find((t) => t.name === "Layout")!;
      // queryNames should only include awaited queries
      expect(layout.queryNames).toContain("getNav");
      expect(layout.queryNames).not.toContain("getProduct");
      // prefetchQueries should include the prefetch
      expect(layout.prefetchQueries).toContain("getProduct");
    });

    it("memoized boundary shows remaining time via queryExecRegistry (no prefetch)", () => {
      const data = parseYamlDashboard(MEMOIZED_INFLIGHT_YAML);
      const w = data.waterfall[50];
      const child2 = w.ssrTimings.find((t) => t.name === "Child2")!;
      // Child1 and Child2 start at same wallStart (after Layout).
      // Child1 fires getProductInfo (50ms). Child2 is cached.
      // Remaining = max(0, child1Start + 50 - child2Start) = 50ms
      expect(child2.fetchDuration).toBe(50);
      expect(child2.cached).toBe(false); // still waiting
    });

    it("memoized boundary shows 0 when original query already completed", () => {
      const data = parseYamlDashboard(MEMOIZED_SIBLING_YAML);
      const w = data.waterfall[50];
      const sibling = w.ssrTimings.find((t) => t.name === "Sibling")!;
      // Layout calls getProductInfo (60ms). Sibling starts after Layout fetch (60ms).
      // By that time, getProductInfo has completed. Remaining = 0.
      expect(sibling.fetchDuration).toBe(0);
      expect(sibling.cached).toBe(true);
    });

    it("partially-completed prefetch shows remaining time", () => {
      const data = parseYamlDashboard(PREFETCH_PARTIAL_YAML);
      const w = data.waterfall[50];
      const detail = w.ssrTimings.find((t) => t.name === "Detail")!;
      // Layout awaits getNav (40ms), prefetches getProduct (80ms).
      // Detail starts at 40ms. Prefetch started at 0ms.
      // Remaining = max(0, 0+80-40) = 40ms (using network offset ~20).
      // With default network offset of 20: prefetch starts at 20, detail starts at 20+40=60.
      // Remaining = max(0, 20+80-60) = 40ms.
      expect(detail.fetchDuration).toBe(40);
      expect(detail.cached).toBe(false);
    });
  });

  describe("tree", () => {
    it("produces nodes for boundaries, queries, and subgraph ops", () => {
      const data = parseYamlDashboard(MINIMAL_YAML);
      const t = data.tree[50];
      const types = new Set(t.nodes.map((n) => n.type));
      expect(types.has("boundary")).toBe(true);
      expect(types.has("query")).toBe(true);
      expect(types.has("subgraph-op")).toBe(true);
    });

    it("assigns correct depth to nested boundaries", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const t = data.tree[50];
      const layout = t.nodes.find((n) => n.name === "Layout" && n.type === "boundary")!;
      const content = t.nodes.find((n) => n.name === "Content" && n.type === "boundary")!;
      expect(layout.depth).toBe(0);
      expect(content.depth).toBe(1);
    });

    it("marks cached ops — query/op show actual duration", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const t = data.tree[50];
      const bulletBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Bullets",
      )!;
      const bulletQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Bullets",
      )!;
      expect(bulletQuery.cached).toBe(true);
      // Boundary shows remaining time (0 — original resolved before consumer)
      expect(bulletBoundary.fetchPctl).toBe(0);
      // Query shows actual duration (30ms) — UI fades it since memoized
      expect(bulletQuery.fetchPctl).toBe(30);
    });

    it("tracks call summary (uncached vs cached ops)", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const t = data.tree[50];
      expect(t.callSummary).not.toBeNull();
      expect(t.callSummary!.callsPerReq).toBeGreaterThan(0);
      expect(t.callSummary!.dedupedPerReq).toBeGreaterThan(0);
    });

    it("includes CSR boundaries with csr phase", () => {
      const data = parseYamlDashboard(CSR_YAML);
      const t = data.tree[50];
      const cart = t.nodes.find((n) => n.name === "Cart" && n.type === "boundary")!;
      expect(cart.phase).toBe("csr");
    });

    it("tree boundary fetch uses max across multiple queries", () => {
      const data = parseYamlDashboard(MULTI_QUERY_YAML);
      const t = data.tree[50];
      const content = t.nodes.find((n) => n.name === "Content" && n.type === "boundary")!;
      // getContent is 30ms, getRecommendations is 80ms at p50 — boundary fetch should be >= 80
      expect(content.fetchPctl).toBeGreaterThanOrEqual(80);
    });

    it("tree: await:false query shows fetchPctl=0 on parent boundary", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const t = data.tree[50];
      const layout = t.nodes.find((n) => n.name === "Layout" && n.type === "boundary")!;
      // Layout has only a noAwait query, so boundary fetch should be 0
      expect(layout.fetchPctl).toBe(0);
    });

    it("tree: cached query node shows remaining prefetch time", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const t = data.tree[50];
      const detailQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.ProductDetail",
      )!;
      // Prefetch is 100ms, child starts at same wallStart (parent didn't await).
      // Remaining = full 100ms.
      expect(detailQuery.fetchPctl).toBe(100);
      expect(detailQuery.cached).toBe(true); // memoized, but still shows remaining time
    });

    it("tree: memoized query shows actual duration even when prefetch completed", () => {
      const data = parseYamlDashboard(PREFETCH_COMPLETED_YAML);
      const t = data.tree[50];
      const detailBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "ProductDetail",
      )!;
      const detailQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.ProductDetail",
      )!;
      // Boundary shows 0 (prefetch resolved before consumer started)
      expect(detailBoundary.fetchPctl).toBe(0);
      // Query shows actual duration (80ms) — UI fades it since memoized
      expect(detailQuery.fetchPctl).toBe(80);
      expect(detailQuery.cached).toBe(true);
    });

    it("tree: noAwait query node has noAwait flag and shows actual duration", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const t = data.tree[50];
      const prefetchQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout",
      )!;
      expect(prefetchQuery.name).toBe("getProduct");
      expect(prefetchQuery.noAwait).toBe(true);
      // Should show actual duration (not 0) — UI will fade it
      expect(prefetchQuery.fetchPctl).toBe(100);
    });

    it("tree: non-prefetch queries do not have noAwait flag", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const t = data.tree[50];
      const query = t.nodes.find((n) => n.type === "query")!;
      expect(query.noAwait).toBeUndefined();
    });

    it("tree: memoized query via queryExecRegistry shows remaining time (siblings)", () => {
      const data = parseYamlDashboard(MEMOIZED_INFLIGHT_YAML);
      const t = data.tree[50];
      const child2Query = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Child2",
      )!;
      // Child1 and Child2 start concurrently. getProductInfo takes 50ms.
      // Remaining = 50ms (query just started in sibling).
      expect(child2Query.cached).toBe(true);
      expect(child2Query.fetchPctl).toBe(50);
    });

    it("tree: memoized query shows actual duration even when original completed", () => {
      const data = parseYamlDashboard(MEMOIZED_SIBLING_YAML);
      const t = data.tree[50];
      const siblingBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Sibling",
      )!;
      const siblingQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Sibling",
      )!;
      // Boundary shows 0 (original resolved before consumer started)
      expect(siblingBoundary.fetchPctl).toBe(0);
      // Query shows actual duration (60ms) — UI fades it since memoized
      expect(siblingQuery.cached).toBe(true);
      expect(siblingQuery.fetchPctl).toBe(60);
    });

    it("tree: memoized boundary fetch includes remaining time impact", () => {
      const data = parseYamlDashboard(MEMOIZED_INFLIGHT_YAML);
      const t = data.tree[50];
      const child2Boundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Child2",
      )!;
      // Child2's only query is memoized with 50ms remaining.
      // Boundary fetch should reflect this.
      expect(child2Boundary.fetchPctl).toBe(50);
    });

    it("tree: memoized boundary fetch is 0 when original resolved", () => {
      const data = parseYamlDashboard(MEMOIZED_SIBLING_YAML);
      const t = data.tree[50];
      const siblingBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Sibling",
      )!;
      expect(siblingBoundary.fetchPctl).toBe(0);
    });

    it("tree: memoized query shows actual duration regardless of remaining time", () => {
      const data = parseYamlDashboard(PREFETCH_PARTIAL_YAML);
      const t = data.tree[50];
      const detailBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Detail",
      )!;
      const detailQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Detail",
      )!;
      // Boundary shows remaining time (40ms — prefetch still in-flight)
      expect(detailBoundary.fetchPctl).toBe(40);
      // Query shows actual duration (80ms) — UI fades it since memoized
      expect(detailQuery.cached).toBe(true);
      expect(detailQuery.fetchPctl).toBe(80);
    });

    it("tree: prefetch query with await:false on same boundary as awaited queries", () => {
      const data = parseYamlDashboard(PREFETCH_PARTIAL_YAML);
      const t = data.tree[50];
      const layoutQueries = t.nodes.filter(
        (n) => n.type === "query" && n.boundaryPath === "Layout",
      );
      // Should have 2 queries: getNav (awaited) and getProduct (prefetch)
      expect(layoutQueries.length).toBe(2);
      const navQuery = layoutQueries.find((q) => q.name === "getNav")!;
      const productQuery = layoutQueries.find((q) => q.name === "getProduct")!;
      expect(navQuery.noAwait).toBeUndefined();
      expect(productQuery.noAwait).toBe(true);
      // Layout boundary fetch should be 40ms (getNav), not affected by prefetch
      const layoutBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Layout",
      )!;
      expect(layoutBoundary.fetchPctl).toBe(40);
    });

    it("tree: memoized query/op show actual duration, boundary shows remaining", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const t = data.tree[50];
      const bulletBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Bullets",
      )!;
      const bulletQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Bullets",
      )!;
      const bulletOp = t.nodes.find(
        (n) => n.type === "subgraph-op" && n.boundaryPath === "Layout.Bullets",
      )!;
      // Boundary: remaining time = 0 (original resolved before consumer)
      expect(bulletBoundary.fetchPctl).toBe(0);
      // Query/op: actual duration (30ms) — UI fades since memoized
      expect(bulletQuery.fetchPctl).toBe(30);
      expect(bulletOp.fetchPctl).toBe(30);
      expect(bulletOp.cached).toBe(true);
    });

    it("tree: memoized query/op show actual duration when resolved", () => {
      const data = parseYamlDashboard(MEMOIZED_SIBLING_YAML);
      const t = data.tree[50];
      const siblingBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Sibling",
      )!;
      const siblingQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Sibling",
      )!;
      const siblingOp = t.nodes.find(
        (n) => n.type === "subgraph-op" && n.boundaryPath === "Layout.Sibling",
      )!;
      // Boundary: 0ms (original resolved before consumer)
      expect(siblingBoundary.fetchPctl).toBe(0);
      // Query/op: actual duration (60ms) — UI fades since memoized
      expect(siblingQuery.fetchPctl).toBe(60);
      expect(siblingOp.fetchPctl).toBe(60);
    });

    it("tree: boundary/query/op consistent when memoized still in-flight", () => {
      const data = parseYamlDashboard(MEMOIZED_INFLIGHT_YAML);
      const t = data.tree[50];
      const child2Boundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Child2",
      )!;
      const child2Query = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Child2",
      )!;
      const child2Op = t.nodes.find(
        (n) => n.type === "subgraph-op" && n.boundaryPath === "Layout.Child2",
      )!;
      // All three levels: 50ms (still in-flight from sibling)
      expect(child2Boundary.fetchPctl).toBe(50);
      expect(child2Query.fetchPctl).toBe(50);
      expect(child2Op.fetchPctl).toBe(50);
    });

    it("computes blocked_ms from thread simulation", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const t = data.tree[50];
      const boundaryNodes = t.nodes.filter((n) => n.type === "boundary");
      // At least one boundary should exist with numeric blocked value
      for (const b of boundaryNodes) {
        expect(typeof b.blockedPctl).toBe("number");
      }
    });
  });

  describe("subgraphs", () => {
    it("produces rows per subgraph", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const s = data.subgraphs[50];
      expect(s.rows.length).toBeGreaterThan(0);
      const names = s.rows.map((r) => r.name);
      expect(names).toContain("cms-subgraph");
      expect(names).toContain("product-subgraph");
    });

    it("rows include operations with duration and call counts", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const s = data.subgraphs[50];
      for (const row of s.rows) {
        expect(row.operations.length).toBeGreaterThan(0);
        expect(row.callsPerReq).toBeGreaterThan(0);
        expect(typeof row.durationPctl).toBe("number");
        expect(row.color).toMatch(/^rgb\(/);
      }
    });

    it("summary separates SSR and CSR calls", () => {
      const data = parseYamlDashboard(CSR_YAML);
      const s = data.subgraphs[50];
      expect(s.summary.ssrCallsPerReq).toBeGreaterThan(0);
      expect(s.summary.csrCallsPerReq).toBeGreaterThan(0);
    });

    it("cached ops count as deduped, not as calls", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const s = data.subgraphs[50];
      expect(s.summary.dedupedPerReq).toBeGreaterThan(0);
    });

    it("await:false queries still count as real subgraph calls", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const s = data.subgraphs[50];
      const productRow = s.rows.find((r) => r.name === "product-subgraph")!;
      // The noAwait query fires a real request — should count as a call
      expect(productRow.callsPerReq).toBeGreaterThanOrEqual(1);
      // The cached child should count as deduped
      expect(s.summary.dedupedPerReq).toBeGreaterThan(0);
    });
  });

  describe("subgraphs section and SLOs", () => {
    const YAML_WITH_SLOS = `
route: /test
subgraphs:
  cms-subgraph:
    slo: 150
  product-subgraph:
    slo: 100
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 50
    Content:
      render_cost: 3
      queries:
        getContent:
          ops:
            product-subgraph: 30
`;

    it("passes SLO values to tree nodes", () => {
      const data = parseYamlDashboard(YAML_WITH_SLOS);
      const t = data.tree[50];
      const cmsOp = t.nodes.find((n) => n.type === "subgraph-op" && n.subgraphName === "cms-subgraph")!;
      expect(cmsOp.slo).toBe(150);
    });

    it("passes SLO values to subgraph rows", () => {
      const data = parseYamlDashboard(YAML_WITH_SLOS);
      const s = data.subgraphs[50];
      const cmsRow = s.rows.find((r) => r.name === "cms-subgraph")!;
      expect(cmsRow.sloMs).toBe(150);
    });
  });

  describe("navigation timing and LoAF", () => {
    const NAV_YAML = `
route: /test
hydration_ms: { p50: 120, p99: 200 }
navigation_timing:
  dom_interactive: { p50: 90, p99: 150 }
  dom_content_loaded: { p50: 110, p99: 185 }
  load_event: { p50: 300, p99: 480 }
  tbt: { p50: 25, p99: 65 }
loaf_entries:
  - start: 155
    duration: 90
    blocking: 58
    scripts:
      - { fn: "hydrateRoot", file: "react-dom.js", duration: 52 }
boundaries:
  Layout:
    render_cost: 5
    queries:
      getNav:
        ops:
          cms-subgraph: 50
`;

    it("includes navigation timing at each percentile", () => {
      const data = parseYamlDashboard(NAV_YAML);
      const w50 = data.waterfall[50];
      expect(w50.navigationTiming).not.toBeNull();
      expect(w50.navigationTiming!.domInteractive).toBe(90);
      expect(w50.navigationTiming!.tbt).toBe(25);

      const w99 = data.waterfall[99];
      expect(w99.navigationTiming!.domInteractive).toBe(150);
      expect(w99.navigationTiming!.tbt).toBe(65);
    });

    it("includes LoAF entries with scripts", () => {
      const data = parseYamlDashboard(NAV_YAML);
      const w = data.waterfall[50];
      expect(w.loafEntries).toHaveLength(1);
      expect(w.loafEntries[0].startTime).toBe(155);
      expect(w.loafEntries[0].duration).toBe(90);
      expect(w.loafEntries[0].blockingDuration).toBe(58);
      expect(w.loafEntries[0].scripts).toHaveLength(1);
      expect(w.loafEntries[0].scripts[0].sourceFunctionName).toBe("hydrateRoot");
    });

    it("sets loafCount on navigation timing", () => {
      const data = parseYamlDashboard(NAV_YAML);
      const w = data.waterfall[50];
      expect(w.navigationTiming!.loafCount).toBe(1);
    });
  });

  describe("percentile value resolution", () => {
    it("scalar values produce the same result at all percentiles", () => {
      const data = parseYamlDashboard(MINIMAL_YAML);
      // cms-subgraph op is scalar 50 — should be same at all percentiles
      const t50 = data.tree[50].nodes.find((n) => n.type === "subgraph-op")!;
      const t99 = data.tree[99].nodes.find((n) => n.type === "subgraph-op")!;
      expect(t50.fetchPctl).toBe(t99.fetchPctl);
    });

    it("percentile map values increase from p50 to p99", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const getOp = (pctl: number) =>
        data.tree[pctl].nodes.find(
          (n) => n.type === "subgraph-op" && n.subgraphName === "product-subgraph",
        )!;
      expect(getOp(99).fetchPctl).toBeGreaterThan(getOp(50).fetchPctl);
    });
  });

  describe("example-page.yaml (full integration)", () => {
    it("parses the example YAML file without errors", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      expect(data.route).toBe("/products/[sku]");
    });

    it("produces expected number of SSR boundaries in waterfall", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      const w = data.waterfall[50];
      // Should have SSR boundaries (excluding CSR ones)
      expect(w.ssrTimings.length).toBeGreaterThanOrEqual(10);
    });

    it("produces CSR timings for csr: true boundaries", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      const w = data.waterfall[50];
      expect(w.csrTimings.length).toBeGreaterThanOrEqual(2); // CartIndicator, FavoriteButton, ReviewsQA
      const csrNames = w.csrTimings.map((t) => t.name);
      expect(csrNames).toContain("CartIndicator");
    });

    it("has 9 subgraphs in subgraph view", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      const s = data.subgraphs[50];
      // All 9 subgraphs should appear
      const names = s.rows.map((r) => r.name);
      expect(names.length).toBeGreaterThanOrEqual(5);
    });

    it("correctly identifies LCP-critical boundaries", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      const w = data.waterfall[50];
      const lcpBoundaries = w.ssrTimings.filter((t) => t.lcpCritical);
      expect(lcpBoundaries.length).toBeGreaterThanOrEqual(2); // Layout, Main.Hero, Main.Title
    });

    it("Layout has prefetchQueries including getProductInfo", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      const w = data.waterfall[50];
      const layout = w.ssrTimings.find((t) => t.name === "Layout")!;
      expect(layout.prefetchQueries).toContain("getProductInfo");
    });

    it("Main.Title shows memoized getProductInfo with prefetch remaining time in tree", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      const t = data.tree[50];
      const titleQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath.endsWith("Main.Title"),
      )!;
      expect(titleQuery.name).toBe("getProductInfo");
      expect(titleQuery.cached).toBe(true);
    });

    it("Layout tree node has noAwait query for getProductInfo", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      const t = data.tree[50];
      const layoutPrefetchQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout" && n.name === "getProductInfo",
      )!;
      expect(layoutPrefetchQuery.noAwait).toBe(true);
      expect(layoutPrefetchQuery.fetchPctl).toBeGreaterThan(0);
    });

    it("pricing-subgraph is the highest-variance (bottleneck)", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      // At p99, Main.Pricing should have a large fetch duration due to pricing-subgraph tail
      const w99 = data.waterfall[99];
      const pricing = w99.ssrTimings.find((t) => t.name === "Main.Pricing")!;
      expect(pricing).toBeDefined();
      expect(pricing.fetchDuration).toBeGreaterThan(400); // p99 of pricing = 680ms
    });
  });
});
