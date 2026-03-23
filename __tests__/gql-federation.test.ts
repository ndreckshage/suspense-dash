import { describe, it, expect } from "vitest";
import { SUBGRAPHS, SUBGRAPH_OPERATIONS, GQL_QUERIES } from "@/lib/gql-federation";

describe("SUBGRAPHS", () => {
  it("defines 9 subgraph services", () => {
    expect(Object.keys(SUBGRAPHS)).toHaveLength(9);
  });

  it("each subgraph has a color and sloMs", () => {
    for (const [, def] of Object.entries(SUBGRAPHS)) {
      expect(def.color).toMatch(/^rgb\(/);
      expect(typeof def.sloMs).toBe("number");
      expect(def.sloMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("includes expected subgraph names", () => {
    const names = Object.keys(SUBGRAPHS);
    expect(names).toContain("product-subgraph");
    expect(names).toContain("pricing-subgraph");
    expect(names).toContain("reviews-subgraph");
    expect(names).toContain("user-subgraph");
  });
});

describe("SUBGRAPH_OPERATIONS", () => {
  it("defines operations with valid subgraph references", () => {
    const subgraphNames = Object.keys(SUBGRAPHS);
    for (const [, def] of Object.entries(SUBGRAPH_OPERATIONS)) {
      expect(subgraphNames).toContain(def.subgraph);
      expect(def.baseMs).toBeGreaterThan(0);
      expect(def.sloMs).toBeGreaterThan(0);
      expect(def.sloMs).toBeGreaterThanOrEqual(def.baseMs);
    }
  });

  it("includes client-side operations", () => {
    expect(SUBGRAPH_OPERATIONS["user.cart"]).toBeDefined();
    expect(SUBGRAPH_OPERATIONS["user.cart"].subgraph).toBe("user-subgraph");
    expect(SUBGRAPH_OPERATIONS["reviews.qa"]).toBeDefined();
  });
});

describe("GQL_QUERIES", () => {
  it("defines queries with valid operation references", () => {
    const opNames = Object.keys(SUBGRAPH_OPERATIONS);
    for (const [, def] of Object.entries(GQL_QUERIES)) {
      expect(def.operations.length).toBeGreaterThan(0);
      for (const op of def.operations) {
        expect(opNames).toContain(op);
      }
    }
  });

  it("includes expected queries", () => {
    const queryNames = Object.keys(GQL_QUERIES);
    expect(queryNames).toContain("getProductInfo");
    expect(queryNames).toContain("getProductPricing");
    expect(queryNames).toContain("getNavigation");
    expect(queryNames).toContain("getUserCart");
    expect(queryNames).toContain("getReviewsQA");
  });

  it("getProductInfo has multiple operations (product.core, product.bullets)", () => {
    expect(GQL_QUERIES.getProductInfo.operations).toContain("product.core");
    expect(GQL_QUERIES.getProductInfo.operations).toContain("product.bullets");
  });

  it("getProductPricing fans out to 3 subgraphs", () => {
    const ops = GQL_QUERIES.getProductPricing.operations;
    expect(ops).toHaveLength(3);
    const subgraphs = ops.map((op) => SUBGRAPH_OPERATIONS[op].subgraph);
    const unique = new Set(subgraphs);
    expect(unique.size).toBe(3);
  });
});
