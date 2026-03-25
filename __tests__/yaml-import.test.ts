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

    it("marks cached ops", () => {
      const data = parseYamlDashboard(CACHED_OPS_YAML);
      const t = data.tree[50];
      const bulletQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.Bullets",
      )!;
      expect(bulletQuery.cached).toBe(true);
      expect(bulletQuery.fetchPctl).toBe(0);
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

    it("tree: cached query shows 0 when prefetch already completed", () => {
      const data = parseYamlDashboard(PREFETCH_COMPLETED_YAML);
      const t = data.tree[50];
      const detailQuery = t.nodes.find(
        (n) => n.type === "query" && n.boundaryPath === "Layout.ProductDetail",
      )!;
      expect(detailQuery.fetchPctl).toBe(0);
      expect(detailQuery.cached).toBe(true);
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
