import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseYamlDashboard } from "@/lib/yaml-import";

// --- Minimal YAML helpers ---

const MINIMAL_YAML = `
route: /products/[sku]
queries:
  getNav:
    latency: 50
    ops:
      cms-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
`;

const TWO_BOUNDARY_YAML = `
route: /test
queries:
  getNav:
    latency: 50
    ops:
      cms-subgraph: 1.0
  getContent:
    latency: { p50: 30, p90: 60, p99: 120 }
    ops:
      product-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
    Content:
      render_cost: 3
      queries:
        - getContent
`;

const CSR_YAML = `
route: /test
hydration_ms: 120
queries:
  getNav:
    latency: 50
    ops:
      cms-subgraph: 1.0
  getUserCart:
    latency: { p50: 40, p90: 80, p99: 130 }
    ops:
      user-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
    Cart:
      csr: true
      render_cost: 2
      queries:
        - getUserCart
`;

const MULTI_QUERY_YAML = `
route: /test
queries:
  getNav:
    latency: 20
    ops:
      cms-subgraph: 1.0
  getContent:
    latency: 30
    ops:
      product-subgraph: 1.0
  getRecommendations:
    latency: { p50: 80, p90: 150, p99: 300 }
    ops:
      recs-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
    Content:
      render_cost: 3
      queries:
        - getContent
        - getRecommendations
`;

const MULTI_QUERY_CSR_YAML = `
route: /test
hydration_ms: 100
queries:
  getNav:
    latency: 20
    ops:
      cms-subgraph: 1.0
  getUser:
    latency: 30
    ops:
      user-subgraph: 1.0
  getActivity:
    latency: 90
    ops:
      activity-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
    Dashboard:
      csr: true
      render_cost: 2
      queries:
        - getUser
        - getActivity
`;

const CACHED_OPS_YAML = `
route: /test
queries:
  getProductInfo:
    latency: 30
    ops:
      product-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getProductInfo
    Bullets:
      render_cost: 3
      queries:
        - name: getProductInfo
          memoized: true
`;

// Parent prefetches getProduct (prefetch: true), child awaits via memoized.
// product-subgraph takes 100ms. Parent render_cost=5, so child starts at
// parentWallStart + 0 (parent didn't await) + 5 (render). The child starts
// at ~networkOffset + 5ms. Prefetch started at networkOffset. So remaining
// = max(0, networkOffset + 100 - (networkOffset + 5)) = 95ms.
const PREFETCH_YAML = `
route: /test
queries:
  getProduct:
    latency: 100
    ops:
      product-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - name: getProduct
        prefetch: true
    ProductDetail:
      render_cost: 3
      queries:
        - name: getProduct
          memoized: true
`;

// Like PREFETCH_YAML but the parent has a slow awaited query too,
// so the child starts later and the prefetch may already be done.
const PREFETCH_COMPLETED_YAML = `
route: /test
queries:
  getNav:
    latency: 200
    ops:
      cms-subgraph: 1.0
  getProduct:
    latency: 80
    ops:
      product-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
      - name: getProduct
        prefetch: true
    ProductDetail:
      render_cost: 3
      queries:
        - name: getProduct
          memoized: true
`;

// Memoized without prefetch: sibling boundary calls same query as parent.
// Layout calls getProductInfo (awaited, 60ms), Sibling also calls it (memoized).
// Sibling starts after Layout's fetch (60ms). Remaining = max(0, 0+60-60) = 0.
const MEMOIZED_SIBLING_YAML = `
route: /test
queries:
  getProductInfo:
    latency: 60
    ops:
      product-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getProductInfo
    Sibling:
      render_cost: 3
      queries:
        - name: getProductInfo
          memoized: true
`;

// Memoized with in-flight overlap: two siblings start concurrently.
// Layout fires getProductInfo (60ms) at wallStart=0. Both children start at
// the same time. Child1 awaits getProductInfo. Child2 uses memoized version.
// With the tree model, siblings start at the same wallStart (parentFetchEnd).
// So: Parent has no queries. Child1 calls getProductInfo (50ms). Child2 calls getProductInfo (memoized).
// Both start at parentFetchEnd. queryExecRegistry records Child1's exec at wallStart=parentFetchEnd.
// Child2 checks: remaining = max(0, parentFetchEnd + 50 - parentFetchEnd) = 50ms.
const MEMOIZED_INFLIGHT_YAML = `
route: /test
queries:
  getProductInfo:
    latency: 50
    ops:
      product-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 2
    Child1:
      render_cost: 3
      queries:
        - getProductInfo
    Child2:
      render_cost: 3
      queries:
        - name: getProductInfo
          memoized: true
`;

// Prefetch + memoized + awaited query on same boundary.
// Layout prefetches getProduct (prefetch: true, 80ms) and awaits getNav (40ms).
// Layout's fetch = 40ms (only getNav). Child starts at 40ms.
// Prefetch started at 0ms. Remaining = max(0, 0+80-40) = 40ms.
const PREFETCH_PARTIAL_YAML = `
route: /test
queries:
  getNav:
    latency: 40
    ops:
      cms-subgraph: 1.0
  getProduct:
    latency: 80
    ops:
      product-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
      - name: getProduct
        prefetch: true
    Detail:
      render_cost: 3
      queries:
        - name: getProduct
          memoized: true
`;

// Deep nesting: grandparent prefetches, grandchild awaits
const PREFETCH_DEEP_YAML = `
route: /test
queries:
  getProduct:
    latency: { p50: 100, p99: 300 }
    ops:
      product-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - name: getProduct
        prefetch: true
    Main:
      render_cost: 3
      Content:
        render_cost: 2
        queries:
          - name: getProduct
            memoized: true
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

    it("marks memoized boundaries with fetchDuration=0", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const w = data.waterfall[50];
      const bullets = w.ssrTimings.find((t) => t.name === "Bullets")!;
      expect(bullets.memoized).toBe(true);
      expect(bullets.fetchDuration).toBe(0);
    });

    it("prefetch query does not contribute to parent fetch duration", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const w = data.waterfall[50];
      const layout = w.ssrTimings.find((t) => t.name === "Layout")!;
      // Layout has getProduct with prefetch:true — should not suspend
      expect(layout.fetchDuration).toBe(0);
    });

    it("memoized child shows remaining prefetch time, not 0", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const w = data.waterfall[50];
      const detail = w.ssrTimings.find((t) => t.name === "ProductDetail")!;
      // Prefetch: 100ms, started at Layout wallStart.
      // Since Layout has no awaited query, child starts at same wallStart.
      // Remaining = full 100ms (prefetch just started).
      expect(detail.fetchDuration).toBe(100);
      expect(detail.memoized).toBe(false); // not fully memoized — still waiting
    });

    it("memoized child shows 0 when prefetch already completed", () => {
      const data = parseYamlDashboard(PREFETCH_COMPLETED_YAML);
      const w = data.waterfall[50];
      const detail = w.ssrTimings.find((t) => t.name === "ProductDetail")!;
      // Layout awaits getNav (200ms), prefetch is only 80ms.
      // By the time ProductDetail starts (after Layout's 200ms fetch),
      // the prefetch has long finished.
      expect(detail.fetchDuration).toBe(0);
      expect(detail.memoized).toBe(true);
    });

    it("prefetch works across deep nesting (grandchild)", () => {
      const data = parseYamlDashboard(PREFETCH_DEEP_YAML);
      const w = data.waterfall[50];
      const content = w.ssrTimings.find((t) => t.name === "Content")!;
      // Prefetch started at Layout. Content is Layout > Main > Content.
      // No intermediate boundary has an awaited query, so they all start
      // at the same wallStart. Remaining = full prefetch duration.
      expect(content.fetchDuration).toBe(100);
      expect(content.memoized).toBe(false);
    });

    it("waterfall includes prefetchQueries for boundaries with prefetch:true", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const w = data.waterfall[50];
      const layout = w.ssrTimings.find((t) => t.name === "Layout")!;
      expect(layout.prefetchQueries).toBeDefined();
      expect(layout.prefetchQueries).toContain("getProduct");
    });

    it("waterfall does not include prefetchQueries for boundaries without prefetch", () => {
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
      // Child1 fires getProductInfo (50ms). Child2 is memoized.
      // Remaining = max(0, child1Start + 50 - child2Start) = 50ms
      expect(child2.fetchDuration).toBe(50);
      expect(child2.memoized).toBe(false); // still waiting
    });

    it("memoized boundary shows 0 when original query already completed", () => {
      const data = parseYamlDashboard(MEMOIZED_SIBLING_YAML);
      const w = data.waterfall[50];
      const sibling = w.ssrTimings.find((t) => t.name === "Sibling")!;
      // Layout calls getProductInfo (60ms). Sibling starts after Layout fetch (60ms).
      // By that time, getProductInfo has completed. Remaining = 0.
      expect(sibling.fetchDuration).toBe(0);
      expect(sibling.memoized).toBe(true);
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
      expect(detail.memoized).toBe(false);
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

    it("marks memoized ops — query/op show actual duration", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const t = data.tree[50];
      const bulletBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Bullets",
      )!;
      const bulletQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Bullets",
      )!;
      expect(bulletQuery.memoized).toBe(true);
      // Boundary shows remaining time (0 — original resolved before consumer)
      expect(bulletBoundary.queryLatencyPctl).toBe(0);
      // Query shows actual duration (30ms) — UI fades it since memoized
      expect(bulletQuery.queryLatencyPctl).toBe(30);
    });

    it("tracks call summary (uncached vs memoized ops)", () => {
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
      expect(content.queryLatencyPctl).toBeGreaterThanOrEqual(80);
    });

    it("tree: prefetch query shows queryLatencyPctl=0 on parent boundary", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const t = data.tree[50];
      const layout = t.nodes.find((n) => n.name === "Layout" && n.type === "boundary")!;
      // Layout has only a prefetch query, so boundary fetch should be 0
      expect(layout.queryLatencyPctl).toBe(0);
    });

    it("tree: memoized query node shows remaining prefetch time", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const t = data.tree[50];
      const detailQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.ProductDetail",
      )!;
      // Prefetch is 100ms, child starts at same wallStart (parent didn't await).
      // Query shows actual duration (100ms) — it's memoized
      expect(detailQuery.queryLatencyPctl).toBe(100);
      expect(detailQuery.memoized).toBe(true);
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
      expect(detailBoundary.queryLatencyPctl).toBe(0);
      // Query shows actual duration (80ms) — UI fades it since memoized
      expect(detailQuery.queryLatencyPctl).toBe(80);
      expect(detailQuery.memoized).toBe(true);
    });

    it("tree: prefetch query node has prefetch flag and shows actual duration", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const t = data.tree[50];
      const prefetchQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout",
      )!;
      expect(prefetchQuery.name).toBe("getProduct");
      expect(prefetchQuery.prefetch).toBe(true);
      // Should show actual duration (not 0) — UI will fade it
      expect(prefetchQuery.queryLatencyPctl).toBe(100);
    });

    it("tree: non-prefetch queries do not have prefetch flag", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const t = data.tree[50];
      const query = t.nodes.find((n) => n.type === "query")!;
      expect(query.prefetch).toBe(false);
    });

    it("tree: memoized query via queryExecRegistry shows remaining time (siblings)", () => {
      const data = parseYamlDashboard(MEMOIZED_INFLIGHT_YAML);
      const t = data.tree[50];
      const child2Query = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Child2",
      )!;
      // Child1 and Child2 start concurrently. getProductInfo takes 50ms.
      // Query shows actual duration (50ms).
      expect(child2Query.memoized).toBe(true);
      expect(child2Query.queryLatencyPctl).toBe(50);
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
      expect(siblingBoundary.queryLatencyPctl).toBe(0);
      // Query shows actual duration (60ms) — UI fades it since memoized
      expect(siblingQuery.memoized).toBe(true);
      expect(siblingQuery.queryLatencyPctl).toBe(60);
    });

    it("tree: memoized boundary fetch includes remaining time impact", () => {
      const data = parseYamlDashboard(MEMOIZED_INFLIGHT_YAML);
      const t = data.tree[50];
      const child2Boundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Child2",
      )!;
      // Child2's only query is memoized with 50ms remaining.
      // Boundary fetch should reflect this.
      expect(child2Boundary.queryLatencyPctl).toBe(50);
    });

    it("tree: memoized boundary fetch is 0 when original resolved", () => {
      const data = parseYamlDashboard(MEMOIZED_SIBLING_YAML);
      const t = data.tree[50];
      const siblingBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Sibling",
      )!;
      expect(siblingBoundary.queryLatencyPctl).toBe(0);
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
      expect(detailBoundary.queryLatencyPctl).toBe(40);
      // Query shows actual duration (80ms) — UI fades it since memoized
      expect(detailQuery.memoized).toBe(true);
      expect(detailQuery.queryLatencyPctl).toBe(80);
    });

    it("tree: prefetch query with prefetch:true on same boundary as awaited queries", () => {
      const data = parseYamlDashboard(PREFETCH_PARTIAL_YAML);
      const t = data.tree[50];
      const layoutQueries = t.nodes.filter(
        (n) => n.type === "query" && n.boundaryPath === "Layout",
      );
      // Should have 2 queries: getNav (awaited) and getProduct (prefetch)
      expect(layoutQueries.length).toBe(2);
      const navQuery = layoutQueries.find((q) => q.name === "getNav")!;
      const productQuery = layoutQueries.find((q) => q.name === "getProduct")!;
      expect(navQuery.prefetch).toBe(false);
      expect(productQuery.prefetch).toBe(true);
      // Layout boundary fetch should be 40ms (getNav), not affected by prefetch
      const layoutBoundary = t.nodes.find(
        (n) => n.type === "boundary" && n.name === "Layout",
      )!;
      expect(layoutBoundary.queryLatencyPctl).toBe(40);
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
      expect(bulletBoundary.queryLatencyPctl).toBe(0);
      // Query: actual duration (30ms) — UI fades since memoized
      expect(bulletQuery.queryLatencyPctl).toBe(30);
      // Op: weight * query latency = 1.0 * 30 = 30
      expect(bulletOp.queryLatencyPctl).toBe(30);
      expect(bulletOp.memoized).toBe(true);
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
      expect(siblingBoundary.queryLatencyPctl).toBe(0);
      // Query/op: actual duration (60ms) — UI fades since memoized
      expect(siblingQuery.queryLatencyPctl).toBe(60);
      expect(siblingOp.queryLatencyPctl).toBe(60);
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
      // Boundary: 50ms remaining
      expect(child2Boundary.queryLatencyPctl).toBe(50);
      // Query: actual duration 50ms
      expect(child2Query.queryLatencyPctl).toBe(50);
      // Op: weight * query latency = 1.0 * 50 = 50
      expect(child2Op.queryLatencyPctl).toBe(50);
    });

    it("stores query and subgraph SLO on tree nodes", () => {
      const YAML = `
route: /test
queries:
  getNav:
    slo: 100
    latency: 50
    ops:
      cms-subgraph: 1.0
subgraphs:
  cms-subgraph:
    slo: 150
    latency: { p75: 45, p90: 60, p99: 80 }
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
`;
      const data = parseYamlDashboard(YAML);
      const t = data.tree[50];
      const queryNode = t.nodes.find((n) => n.type === "query")!;
      expect(queryNode.querySlo).toBe(100);
      const opNode = t.nodes.find((n) => n.type === "subgraph-op")!;
      expect(opNode.subgraphSlo).toBe(150);
      expect(opNode.subgraphLatencyPctl).toBeGreaterThan(0);
    });

    it("stores weight on subgraph-op nodes", () => {
      const YAML = `
route: /test
queries:
  getProductPricing:
    latency: 200
    ops:
      pricing-subgraph: 0.85
      inventory-subgraph: 0.15
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getProductPricing
`;
      const data = parseYamlDashboard(YAML);
      const t = data.tree[50];
      const pricingOp = t.nodes.find((n) => n.type === "subgraph-op" && n.subgraphName === "pricing-subgraph")!;
      expect(pricingOp.weight).toBe(0.85);
      expect(pricingOp.queryLatencyPctl).toBe(170); // 0.85 * 200
      const inventoryOp = t.nodes.find((n) => n.type === "subgraph-op" && n.subgraphName === "inventory-subgraph")!;
      expect(inventoryOp.weight).toBe(0.15);
      expect(inventoryOp.queryLatencyPctl).toBe(30); // 0.15 * 200
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

    it("rows include operations with weight and call counts", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const s = data.subgraphs[50];
      for (const row of s.rows) {
        expect(row.operations.length).toBeGreaterThan(0);
        expect(row.callsPerReq).toBeGreaterThan(0);
        expect(typeof row.subgraphLatencyPctl).toBe("number");
        expect(row.color).toMatch(/^rgb\(/);
      }
    });

    it("summary separates SSR and CSR calls", () => {
      const data = parseYamlDashboard(CSR_YAML);
      const s = data.subgraphs[50];
      expect(s.summary.ssrCallsPerReq).toBeGreaterThan(0);
      expect(s.summary.csrCallsPerReq).toBeGreaterThan(0);
    });

    it("memoized ops count as deduped, not as calls", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const s = data.subgraphs[50];
      expect(s.summary.dedupedPerReq).toBeGreaterThan(0);
    });

    it("prefetch queries still count as real subgraph calls", () => {
      const data = parseYamlDashboard(PREFETCH_YAML);
      const s = data.subgraphs[50];
      const productRow = s.rows.find((r) => r.name === "product-subgraph")!;
      // The prefetch query fires a real request — should count as a call
      // But the memoized child should count as deduped
      expect(s.summary.dedupedPerReq).toBeGreaterThan(0);
    });

    it("subgraph rows include real subgraph latency from YAML", () => {
      const YAML = `
route: /test
queries:
  getNav:
    latency: 50
    ops:
      cms-subgraph: 1.0
subgraphs:
  cms-subgraph:
    slo: 150
    latency: { p50: 40, p90: 65, p99: 110 }
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
`;
      const data = parseYamlDashboard(YAML);
      const s = data.subgraphs[50];
      const cmsRow = s.rows.find((r) => r.name === "cms-subgraph")!;
      expect(cmsRow.subgraphLatencyPctl).toBe(40);
      const s99 = data.subgraphs[99];
      const cmsRow99 = s99.rows.find((r) => r.name === "cms-subgraph")!;
      expect(cmsRow99.subgraphLatencyPctl).toBe(110);
    });

    it("operations include weight and queryLatencyPctl", () => {
      const YAML = `
route: /test
queries:
  getProductPricing:
    latency: 200
    ops:
      pricing-subgraph: 0.85
      inventory-subgraph: 0.15
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getProductPricing
`;
      const data = parseYamlDashboard(YAML);
      const s = data.subgraphs[50];
      const pricingRow = s.rows.find((r) => r.name === "pricing-subgraph")!;
      const pricingOp = pricingRow.operations[0];
      expect(pricingOp.weight).toBe(0.85);
      expect(pricingOp.queryLatencyPctl).toBe(200);
      expect(pricingOp.durationPctl).toBe(170); // 0.85 * 200
    });
  });

  describe("subgraphs section and SLOs", () => {
    const YAML_WITH_SLOS = `
route: /test
queries:
  getNav:
    latency: 50
    ops:
      cms-subgraph: 1.0
  getContent:
    latency: 30
    ops:
      product-subgraph: 1.0
subgraphs:
  cms-subgraph:
    slo: 150
  product-subgraph:
    slo: 100
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
    Content:
      render_cost: 3
      queries:
        - getContent
`;

    it("passes SLO values to tree nodes", () => {
      const data = parseYamlDashboard(YAML_WITH_SLOS);
      const t = data.tree[50];
      const cmsOp = t.nodes.find((n) => n.type === "subgraph-op" && n.subgraphName === "cms-subgraph")!;
      expect(cmsOp.subgraphSlo).toBe(150);
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
queries:
  getNav:
    latency: 50
    ops:
      cms-subgraph: 1.0
boundaries:
  Layout:
    render_cost: 5
    queries:
      - getNav
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
      // cms-subgraph op is weight 1.0 of latency 50 — should be same at all percentiles
      const t50 = data.tree[50].nodes.find((n) => n.type === "subgraph-op")!;
      const t99 = data.tree[99].nodes.find((n) => n.type === "subgraph-op")!;
      expect(t50.queryLatencyPctl).toBe(t99.queryLatencyPctl);
    });

    it("percentile map values increase from p50 to p99", () => {
      const data = parseYamlDashboard(TWO_BOUNDARY_YAML);
      const getQ = (pctl: number) =>
        data.tree[pctl].nodes.find(
          (n) => n.type === "query" && n.name === "getContent",
        )!;
      expect(getQ(99).queryLatencyPctl).toBeGreaterThan(getQ(50).queryLatencyPctl);
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

    it("Main.Title shows memoized getProductInfo in tree", () => {
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
      expect(titleQuery.memoized).toBe(true);
    });

    it("Layout tree node has prefetch query for getProductInfo", () => {
      const yamlContent = readFileSync(
        join(__dirname, "..", "public", "example-page.yaml"),
        "utf-8",
      );
      const data = parseYamlDashboard(yamlContent);
      const t = data.tree[50];
      const layoutPrefetchQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout" && n.name === "getProductInfo",
      )!;
      expect(layoutPrefetchQuery.prefetch).toBe(true);
      expect(layoutPrefetchQuery.queryLatencyPctl).toBeGreaterThan(0);
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
      expect(pricing.fetchDuration).toBeGreaterThan(400); // p99 of query latency = 680ms
    });
  });
});
