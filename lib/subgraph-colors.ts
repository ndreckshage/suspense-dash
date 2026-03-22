/**
 * Dynamic color assignment for subgraphs.
 *
 * Assigns colors from a fixed palette based on the sorted order of subgraph
 * names, so colors are stable for a given set of subgraphs but don't depend
 * on a hardcoded registry.
 */

const PALETTE = [
  "rgb(59, 130, 246)",   // blue
  "rgb(139, 92, 246)",   // violet
  "rgb(245, 158, 11)",   // amber
  "rgb(34, 197, 94)",    // green
  "rgb(249, 115, 22)",   // orange
  "rgb(236, 72, 153)",   // pink
  "rgb(99, 102, 241)",   // indigo
  "rgb(6, 182, 212)",    // cyan
  "rgb(168, 85, 247)",   // purple
  "rgb(234, 179, 8)",    // yellow
  "rgb(244, 63, 94)",    // rose
  "rgb(20, 184, 166)",   // teal
];

/**
 * Build a name→color map for a set of subgraph names.
 * Names are sorted alphabetically so the assignment is deterministic.
 */
export function buildSubgraphColorMap(names: Iterable<string>): Map<string, string> {
  const sorted = [...names].sort();
  const map = new Map<string, string>();
  for (let i = 0; i < sorted.length; i++) {
    map.set(sorted[i], PALETTE[i % PALETTE.length]);
  }
  return map;
}

/** Fallback color when a subgraph name isn't in the map. */
export const DEFAULT_SUBGRAPH_COLOR = "rgb(161, 161, 170)";
