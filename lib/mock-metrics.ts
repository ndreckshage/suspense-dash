/**
 * Types for pre-computed mock dashboard data (from YAML import).
 *
 * When YAML data is loaded, each dashboard tab receives pre-computed
 * values keyed by percentile, bypassing the live-data aggregation logic.
 */

import type { NavigationTiming } from "./client-metrics-store";

// ---- Waterfall (CriticalInitPath) ----

export interface WaterfallTiming {
  name: string;
  boundaryPath: string;
  wallStart: number;
  fetchDuration: number;
  renderCost: number;
  blocked: number;
  total: number;
  lcpCritical: boolean;
  queryName: string;
  queryNames: string[];
  cached: boolean;
  /** Color of the heaviest subgraph in this boundary's queries */
  subgraphColor?: string;
  /** Query names that were prefetched (await: false) by this boundary */
  prefetchQueries?: string[];
}

export interface WaterfallCsrTiming {
  name: string;
  boundaryPath: string;
  wallStart: number;
  fetchDuration: number;
  queryName: string;
  queryNames: string[];
}

export interface MockLoAFEntry {
  startTime: number;
  duration: number;
  blockingDuration: number;
  scripts: { sourceURL: string; sourceFunctionName: string; duration: number }[];
}

export interface MockWaterfallData {
  ssrTimings: WaterfallTiming[];
  csrTimings: WaterfallCsrTiming[];
  hydrationMs: number;
  initializationMs: number;
  navigationTiming: NavigationTiming | null;
  loafEntries: MockLoAFEntry[];
  /** Edge/network overhead before the server starts processing (ms) */
  networkOffsetMs: number;
  /** Browser image download + decode + paint latency after LCP HTML streams (ms) */
  lcpImageLatencyMs: number;
}

// ---- Tree (BoundaryTreeTable) ----

export interface MockTreeNode {
  name: string;
  path: string;
  depth: number;
  type: "boundary" | "query" | "subgraph-op";
  boundaryPath: string;
  wallStartPctl: number;
  fetchPctl: number;
  renderCostPctl: number;
  blockedPctl: number;
  totalPctl: number;
  slo: number;
  lcpCritical: boolean;
  cached: boolean;
  /** Query was prefetched (await: false) — fires but doesn't suspend */
  noAwait?: boolean;
  subgraphName?: string;
  subgraphColor?: string;
  hasChildren: boolean;
  phase?: "ssr" | "csr";
}

export interface MockTreeData {
  nodes: MockTreeNode[];
  callSummary: { callsPerReq: number; dedupedPerReq: number } | null;
}

// ---- Subgraph (SubgraphCallsTab) ----

export interface MockOperationDetail {
  name: string;
  callsPerReq: number;
  durationPctl: number;
  boundaries: string[];
  queryNames: string[];
  isClient: boolean;
}

export interface MockSubgraphRow {
  name: string;
  color: string;
  sloMs: number;
  callsPerReq: number;
  durationPctl: number;
  operations: MockOperationDetail[];
}

export interface MockSubgraphData {
  summary: {
    ssrCallsPerReq: number;
    csrCallsPerReq: number;
    dedupedPerReq: number;
  };
  rows: MockSubgraphRow[];
}

// ---- Combined mock dashboard data ----

export interface MockDashboardData {
  route: string;
  /** Pre-computed data keyed by percentile (50, 75, 90, 95, 99) */
  waterfall: Record<number, MockWaterfallData>;
  tree: Record<number, MockTreeData>;
  subgraphs: Record<number, MockSubgraphData>;
}
