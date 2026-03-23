import { describe, it, expect } from "vitest";
import {
  filterLoafsByCsrCutoff,
  mergeLoafEntries,
  getLastCsrQueryStart,
} from "@/lib/loaf-utils";

function makeLoaf(startTime: number, duration: number, blockingDuration = 0) {
  return { startTime, duration, blockingDuration };
}

describe("getLastCsrQueryStart", () => {
  it("returns Infinity when there are no CSR timings", () => {
    expect(getLastCsrQueryStart([])).toBe(Infinity);
  });

  it("returns the max wallStart across CSR timings", () => {
    const timings = [
      { wallStart: 100 },
      { wallStart: 300 },
      { wallStart: 200 },
    ];
    expect(getLastCsrQueryStart(timings)).toBe(300);
  });

  it("works with a single timing", () => {
    expect(getLastCsrQueryStart([{ wallStart: 150 }])).toBe(150);
  });
});

describe("filterLoafsByCsrCutoff", () => {
  it("keeps LoAFs that start before the cutoff", () => {
    const entries = [makeLoaf(50, 80), makeLoaf(100, 60), makeLoaf(200, 70)];
    const result = filterLoafsByCsrCutoff(entries, 150);
    expect(result).toEqual([entries[0], entries[1]]);
  });

  it("excludes LoAFs that start at or after the cutoff", () => {
    const entries = [makeLoaf(150, 60), makeLoaf(200, 50)];
    const result = filterLoafsByCsrCutoff(entries, 150);
    expect(result).toEqual([]);
  });

  it("keeps all LoAFs when cutoff is Infinity (no CSR queries)", () => {
    const entries = [makeLoaf(50, 80), makeLoaf(500, 60)];
    const result = filterLoafsByCsrCutoff(entries, Infinity);
    expect(result).toEqual(entries);
  });

  it("returns empty array for empty input", () => {
    expect(filterLoafsByCsrCutoff([], 100)).toEqual([]);
  });

  it("includes a LoAF whose duration extends past the cutoff but starts before it", () => {
    const entry = makeLoaf(140, 100); // starts 140, ends 240
    const result = filterLoafsByCsrCutoff([entry], 150);
    expect(result).toEqual([entry]);
  });
});

describe("mergeLoafEntries", () => {
  it("returns empty array for empty input", () => {
    expect(mergeLoafEntries([])).toEqual([]);
  });

  it("returns a single group for a single entry", () => {
    const entries = [makeLoaf(100, 60, 30)];
    const result = mergeLoafEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startTime: 100,
      endTime: 160,
      totalDuration: 60,
      totalBlocking: 30,
    });
    expect(result[0].entries).toHaveLength(1);
  });

  it("merges entries within 20ms gap (default)", () => {
    // entry1: 100-160, entry2: 170-230 (gap = 10ms, should merge)
    const entries = [makeLoaf(100, 60, 20), makeLoaf(170, 60, 30)];
    const result = mergeLoafEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startTime: 100,
      endTime: 230,
      totalDuration: 120,
      totalBlocking: 50,
    });
    expect(result[0].entries).toHaveLength(2);
  });

  it("merges entries exactly 20ms apart", () => {
    // entry1: 100-160, entry2: 180-240 (gap = 20ms, should merge)
    const entries = [makeLoaf(100, 60, 10), makeLoaf(180, 60, 15)];
    const result = mergeLoafEntries(entries);
    expect(result).toHaveLength(1);
  });

  it("does not merge entries more than 20ms apart", () => {
    // entry1: 100-160, entry2: 181-241 (gap = 21ms, should not merge)
    const entries = [makeLoaf(100, 60, 10), makeLoaf(181, 60, 15)];
    const result = mergeLoafEntries(entries);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ startTime: 100, endTime: 160 });
    expect(result[1]).toMatchObject({ startTime: 181, endTime: 241 });
  });

  it("sorts entries by startTime before merging", () => {
    const entries = [makeLoaf(170, 60, 30), makeLoaf(100, 60, 20)];
    const result = mergeLoafEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBe(100);
    expect(result[0].endTime).toBe(230);
  });

  it("creates separate groups when there are large gaps", () => {
    const entries = [
      makeLoaf(50, 60, 10),   // 50-110
      makeLoaf(60, 60, 15),   // 60-120  (overlaps, merged with first)
      makeLoaf(300, 80, 40),  // 300-380 (gap > 20ms, separate)
      makeLoaf(310, 50, 20),  // 310-360 (within 20ms of 300-380, merged)
    ];
    const result = mergeLoafEntries(entries);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      startTime: 50,
      endTime: 120,
      totalDuration: 120,
      totalBlocking: 25,
    });
    expect(result[0].entries).toHaveLength(2);
    expect(result[1]).toMatchObject({
      startTime: 300,
      endTime: 380,
      totalDuration: 130,
      totalBlocking: 60,
    });
    expect(result[1].entries).toHaveLength(2);
  });

  it("uses endTime as max when entries overlap", () => {
    // entry1: 100-200, entry2: 120-150 (fully inside entry1)
    const entries = [makeLoaf(100, 100, 40), makeLoaf(120, 30, 10)];
    const result = mergeLoafEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].endTime).toBe(200); // keeps the larger endTime
  });

  it("respects custom gap parameter", () => {
    const entries = [makeLoaf(100, 60, 10), makeLoaf(165, 60, 15)];
    // gap = 5ms, default 20ms threshold would merge, but custom 3ms should not
    expect(mergeLoafEntries(entries, 3)).toHaveLength(2);
    expect(mergeLoafEntries(entries, 5)).toHaveLength(1);
  });
});

describe("integration: filter then merge", () => {
  it("filters out post-CSR LoAFs then merges remaining", () => {
    const entries = [
      makeLoaf(50, 60, 20),   // 50-110, before CSR
      makeLoaf(120, 40, 15),  // 120-160, before CSR, within 20ms of first
      makeLoaf(300, 80, 40),  // 300-380, after CSR starts at 200
      makeLoaf(500, 60, 30),  // 500-560, well after CSR
    ];
    const cutoff = 200;
    const eligible = filterLoafsByCsrCutoff(entries, cutoff);
    expect(eligible).toHaveLength(2);

    const merged = mergeLoafEntries(eligible);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      startTime: 50,
      endTime: 160,
      totalDuration: 100,
      totalBlocking: 35,
    });
  });

  it("keeps all LoAFs when no CSR queries exist", () => {
    const entries = [makeLoaf(50, 60, 20), makeLoaf(500, 60, 30)];
    const cutoff = getLastCsrQueryStart([]); // Infinity
    const eligible = filterLoafsByCsrCutoff(entries, cutoff);
    expect(eligible).toHaveLength(2);
  });
});
