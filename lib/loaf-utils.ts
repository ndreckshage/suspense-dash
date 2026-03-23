/**
 * Utilities for filtering and merging Long Animation Frame (LoAF) entries
 * for the CSR timeline visualization.
 */

export interface LoAFLike {
  startTime: number;
  duration: number;
  blockingDuration: number;
}

export interface MergedLoAFGroup<T extends LoAFLike> {
  startTime: number;
  endTime: number;
  totalDuration: number;
  totalBlocking: number;
  entries: T[];
}

/**
 * Filter LoAF entries to only those that started before the last CSR query begins.
 * If there are no CSR queries, all entries are included.
 */
export function filterLoafsByCsrCutoff<T extends LoAFLike>(
  entries: T[],
  lastCsrQueryStart: number,
): T[] {
  return entries.filter((e) => e.startTime < lastCsrQueryStart);
}

/**
 * Merge adjacent LoAF entries that are within `gapMs` of each other into groups.
 * Entries are sorted by startTime before grouping.
 */
export function mergeLoafEntries<T extends LoAFLike>(
  entries: T[],
  gapMs: number = 20,
): MergedLoAFGroup<T>[] {
  const merged: MergedLoAFGroup<T>[] = [];
  const sorted = [...entries].sort((a, b) => a.startTime - b.startTime);

  for (const entry of sorted) {
    const entryEnd = entry.startTime + entry.duration;
    const last = merged[merged.length - 1];
    if (last && entry.startTime - last.endTime <= gapMs) {
      last.endTime = Math.max(last.endTime, entryEnd);
      last.totalDuration += entry.duration;
      last.totalBlocking += entry.blockingDuration;
      last.entries.push(entry);
    } else {
      merged.push({
        startTime: entry.startTime,
        endTime: entryEnd,
        totalDuration: entry.duration,
        totalBlocking: entry.blockingDuration,
        entries: [entry],
      });
    }
  }

  return merged;
}

/**
 * Compute the last CSR query start time from an array of timings.
 * Returns Infinity if there are no CSR timings (so no LoAFs are filtered out).
 */
export function getLastCsrQueryStart(
  csrTimings: { wallStart: number }[],
): number {
  if (csrTimings.length === 0) return Infinity;
  return Math.max(...csrTimings.map((t) => t.wallStart));
}
