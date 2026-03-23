import { describe, it, expect } from "vitest";
import { percentile, median } from "@/lib/percentile";

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns the single value for a one-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("computes p50 of a sorted range", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
  });

  it("computes p90 correctly", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 90)).toBe(90);
  });

  it("computes p99 correctly — returns highest value for 10-element array", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 99)).toBe(100);
  });

  it("works with unsorted input", () => {
    const values = [50, 10, 90, 30, 70];
    expect(percentile(values, 50)).toBe(50);
  });

  it("does not mutate the original array", () => {
    const values = [50, 10, 90, 30, 70];
    const copy = [...values];
    percentile(values, 50);
    expect(values).toEqual(copy);
  });

  it("rounds the result", () => {
    // percentile uses Math.round, so results should be integers
    const result = percentile([1, 2, 3, 4, 5], 50);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the single value for one element", () => {
    expect(median([7])).toBe(7);
  });

  it("returns the middle value for odd-length arrays", () => {
    expect(median([1, 3, 5])).toBe(3);
    expect(median([10, 20, 30, 40, 50])).toBe(30);
  });

  it("returns the average of two middle values for even-length arrays", () => {
    expect(median([1, 3])).toBe(2);
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("works with unsorted input", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("does not mutate the original array", () => {
    const values = [5, 1, 3];
    const copy = [...values];
    median(values);
    expect(values).toEqual(copy);
  });
});
