import { describe, it, expect } from "vitest";
import { buildSubgraphColorMap, DEFAULT_SUBGRAPH_COLOR } from "@/lib/subgraph-colors";

describe("buildSubgraphColorMap", () => {
  it("assigns colors to subgraph names", () => {
    const names = ["alpha", "beta", "gamma"];
    const map = buildSubgraphColorMap(names);
    expect(map.size).toBe(3);
    expect(map.has("alpha")).toBe(true);
    expect(map.has("beta")).toBe(true);
    expect(map.has("gamma")).toBe(true);
  });

  it("assigns colors deterministically regardless of input order", () => {
    const map1 = buildSubgraphColorMap(["beta", "alpha", "gamma"]);
    const map2 = buildSubgraphColorMap(["gamma", "alpha", "beta"]);
    expect(map1.get("alpha")).toBe(map2.get("alpha"));
    expect(map1.get("beta")).toBe(map2.get("beta"));
    expect(map1.get("gamma")).toBe(map2.get("gamma"));
  });

  it("assigns different colors to different names (up to palette size)", () => {
    const names = ["a", "b", "c", "d", "e"];
    const map = buildSubgraphColorMap(names);
    const colors = [...map.values()];
    const unique = new Set(colors);
    expect(unique.size).toBe(5);
  });

  it("wraps around palette when more names than colors", () => {
    const names = Array.from({ length: 15 }, (_, i) => `subgraph-${i}`);
    const map = buildSubgraphColorMap(names);
    expect(map.size).toBe(15);
    // Palette has 12 colors, so 13th wraps to 1st
    const sorted = [...names].sort();
    expect(map.get(sorted[12])).toBe(map.get(sorted[0]));
  });

  it("handles empty input", () => {
    const map = buildSubgraphColorMap([]);
    expect(map.size).toBe(0);
  });

  it("handles Set input", () => {
    const map = buildSubgraphColorMap(new Set(["x", "y"]));
    expect(map.size).toBe(2);
  });
});

describe("DEFAULT_SUBGRAPH_COLOR", () => {
  it("is a gray rgb value", () => {
    expect(DEFAULT_SUBGRAPH_COLOR).toMatch(/^rgb\(/);
  });
});
