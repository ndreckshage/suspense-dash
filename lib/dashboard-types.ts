/**
 * Canonical dashboard data types.
 *
 * Both data sources (live recorded metrics and YAML import) are converted
 * into this shape — pre-computed views keyed by percentile. Dashboard
 * components consume only these types.
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
  memoized: boolean;
  /** Color of the heaviest subgraph in this boundary's queries */
  subgraphColor?: string;
  /** Query names that were prefetched (prefetch: true) by this boundary */
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

export interface DashboardLoAFEntry {
  startTime: number;
  duration: number;
  blockingDuration: number;
  scripts: { sourceURL: string; sourceFunctionName: string; duration: number }[];
}

export interface DashboardWaterfallData {
  ssrTimings: WaterfallTiming[];
  csrTimings: WaterfallCsrTiming[];
  hydrationMs: number;
  initializationMs: number;
  navigationTiming: NavigationTiming | null;
  loafEntries: DashboardLoAFEntry[];
  /** Edge/network overhead before the server starts processing (ms) */
  networkOffsetMs: number;
  /** Browser image download + decode + paint latency after LCP HTML streams (ms) */
  lcpImageLatencyMs: number;
}

// ---- Tree (BoundaryTreeTable) ----

export interface DashboardTreeNode {
  name: string;
  path: string;
  depth: number;
  type: "boundary" | "query" | "subgraph-op";
  boundaryPath: string;
  queryLatencyPctl: number;      // query: actual latency at pctl; subgraph: weight × query latency; boundary: max of awaited query latencies
  subgraphLatencyPctl: number;   // subgraph: real from subgraphs section; 0 for boundary/query
  querySlo: number;              // query/boundary: query-level SLO; 0 for subgraph
  subgraphSlo: number;           // subgraph: subgraph-level SLO; 0 for boundary/query
  weight: number;                // subgraph-op: the weight (0–1); 0 for boundary/query
  lcpCritical: boolean;
  memoized: boolean;
  prefetch: boolean;
  subgraphName?: string;
  subgraphColor?: string;
  hasChildren: boolean;
  phase?: "ssr" | "csr";
  // Internal use for waterfall computation, not displayed in tree columns
  wallStartPctl: number;
  renderCostPctl: number;
}

export interface DashboardTreeData {
  nodes: DashboardTreeNode[];
  callSummary: { callsPerReq: number; dedupedPerReq: number } | null;
}

// ---- Subgraph (SubgraphCallsTab) ----

export interface DashboardOperationDetail {
  name: string;           // query name
  callsPerReq: number;
  weight: number;         // the op weight (0–1)
  queryLatencyPctl: number; // parent query's latency at pctl
  durationPctl: number;   // weight × queryLatencyPctl
  boundaries: string[];
  queryNames: string[];
  isClient: boolean;
}

export interface DashboardSubgraphRow {
  name: string;
  color: string;
  sloMs: number;
  callsPerReq: number;
  subgraphLatencyPctl: number;
  operations: DashboardOperationDetail[];
}

export interface DashboardSubgraphData {
  summary: {
    ssrCallsPerReq: number;
    csrCallsPerReq: number;
    dedupedPerReq: number;
  };
  rows: DashboardSubgraphRow[];
}

// ---- Combined dashboard data ----

export interface DashboardDateRange {
  /** ISO date string (YYYY-MM-DD) or descriptive label */
  from: string;
  to: string;
}

export interface DashboardData {
  route: string;
  /** Date the snapshot was taken (ISO date string) */
  snapshotDate?: string;
  /** Date range for latency data */
  latencyDateRange?: DashboardDateRange;
  /** Pre-computed data keyed by percentile (50, 75, 90, 95, 99) */
  waterfall: Record<number, DashboardWaterfallData>;
  tree: Record<number, DashboardTreeData>;
  subgraphs: Record<number, DashboardSubgraphData>;
}
