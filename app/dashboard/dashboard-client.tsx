"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { CriticalInitPath } from "@/components/dashboard/CriticalInitPath";
import { SubgraphCallsTab } from "@/components/dashboard/SubgraphCallsTab";
import {
  clientMetricsStore,
  type ClientMetrics,
} from "@/lib/client-metrics-store";
import type { DashboardData } from "@/lib/dashboard-types";
import { parseYamlDashboard } from "@/lib/yaml-import";
import { convertLiveMetrics } from "@/lib/live-metrics-to-mock";
import { YamlUpload } from "@/components/dashboard/YamlUpload";

const PERCENTILE_OPTIONS = [50, 75, 90, 95, 99] as const;

const TAB_KEYS = ["lcp", "tree", "subgraphs"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type DataSource = "demo" | "yaml-file" | "yaml-url";

export function DashboardClient({
  initialTab,
  runUrl,
}: {
  initialTab: TabKey;
  runUrl?: string;
}) {
  const [metrics, setMetrics] = useState<ClientMetrics | null>(null);
  const [yamlData, setYamlData] = useState<DashboardData | null>(null);
  const [activeTab, setActiveTabState] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(true);
  const [pctl, setPctl] = useState<number>(99);
  const [dataSource, setDataSource] = useState<DataSource>("demo");
  const [urlError, setUrlError] = useState<string | null>(null);

  const setActiveTab = useCallback((tab: TabKey) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === "lcp") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    window.history.replaceState({}, "", decodeURIComponent(url.toString()));
  }, []);

  // Sync tab state on browser back/forward
  useEffect(() => {
    const getTabFromUrl = (): TabKey => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      return TAB_KEYS.includes(tab as TabKey) ? (tab as TabKey) : "lcp";
    };
    const onPopState = () => setActiveTabState(getTabFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const refreshMetrics = useCallback(() => {
    setLoading(true);
    setYamlData(null);
    setDataSource("demo");
    const data = clientMetricsStore.getMetrics();
    setMetrics(data);
    setLoading(false);
  }, []);

  const loadYamlData = useCallback(
    (data: DashboardData, source: DataSource = "yaml-file") => {
      setYamlData(data);
      setMetrics(null);
      setDataSource(source);
      setLoading(false);
    },
    [],
  );

  // Load YAML from ?run=URL parameter
  useEffect(() => {
    if (!runUrl) return;
    let cancelled = false;
    setLoading(true);
    setUrlError(null);
    fetch(runUrl)
      .then((res) => {
        if (!res.ok)
          throw new Error(
            `Failed to fetch YAML: ${res.status} ${res.statusText}`,
          );
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        const data = parseYamlDashboard(text);
        loadYamlData(data, "yaml-url");
      })
      .catch((err) => {
        if (cancelled) return;
        setUrlError(
          err instanceof Error ? err.message : "Failed to load YAML from URL",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runUrl, loadYamlData]);

  useEffect(() => {
    if (runUrl) return; // skip seed when loading from URL
    clientMetricsStore.seedIfFirstVisit().then(() => refreshMetrics());
  }, [refreshMetrics, runUrl]);

  function clearMetrics() {
    clientMetricsStore.clear();
    setYamlData(null);
    refreshMetrics();
  }

  async function loadDemoData() {
    setLoading(true);
    setYamlData(null);
    await clientMetricsStore.loadSeedData();
    refreshMetrics();
  }

  const isYaml = yamlData !== null;

  // Convert live metrics to DashboardData (unified data shape)
  const mockData: DashboardData | null = useMemo(() => {
    if (yamlData) return yamlData;
    if (metrics && metrics.totalPageLoads > 0) return convertLiveMetrics(metrics);
    return null;
  }, [yamlData, metrics]);

  // Compute LCP-path subgraph names from tree data (for subgraph tab filter)
  const lcpSubgraphs = useMemo(() => {
    if (!mockData) return new Set<string>();
    const treeData = mockData.tree[pctl];
    if (!treeData) return new Set<string>();
    const nodes = treeData.nodes;

    // Find LCP boundary paths + ancestors
    const lcpPaths = new Set<string>();
    for (const n of nodes) {
      if (n.lcpCritical) lcpPaths.add(n.boundaryPath);
    }
    const withAncestors = new Set(lcpPaths);
    for (const path of lcpPaths) {
      let candidate = path;
      while (true) {
        const idx = candidate.lastIndexOf(".");
        if (idx === -1) break;
        candidate = candidate.substring(0, idx);
        withAncestors.add(candidate);
      }
    }

    // Collect subgraph names from non-prefetch ops in LCP boundaries
    const names = new Set<string>();
    for (const n of nodes) {
      if (n.type === "subgraph-op" && n.subgraphName && !n.prefetch && withAncestors.has(n.boundaryPath)) {
        names.add(n.subgraphName);
      }
    }
    return names;
  }, [mockData, pctl]);

  const hasData = mockData !== null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8 md:px-6 md:py-12 font-mono overflow-x-hidden">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-base md:text-xl font-bold text-white">
                Suspense Dash
              </h1>
              {isYaml && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 border border-blue-800 text-blue-300">
                  {dataSource === "yaml-url" ? "LINK" : "YAML"}
                </span>
              )}
              {!isYaml && metrics && metrics.totalPageLoads > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 border border-emerald-800 text-emerald-300">
                  DEMO
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <select
                value={pctl}
                onChange={(e) => setPctl(Number(e.target.value))}
                className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-zinc-500 w-14"
              >
                {PERCENTILE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    p{p}
                  </option>
                ))}
              </select>
              <span className="text-xs text-zinc-500 truncate hidden sm:inline">
                {isYaml
                  ? `${mockData!.route}${dataSource === "yaml-url" ? ` — ${runUrl}` : " — YAML import"}`
                  : `/products/[sku] — ${metrics ? `${metrics.totalPageLoads} loads` : "loading..."}`}
              </span>
              <span className="text-xs text-zinc-500 truncate sm:hidden">
                {isYaml
                  ? mockData!.route
                  : metrics
                    ? `${metrics.totalPageLoads} loads`
                    : "loading..."}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isYaml && hasData && (
              <button
                onClick={clearMetrics}
                className="px-2.5 py-1 text-xs border border-zinc-700 rounded text-zinc-500 hover:text-red-300 hover:border-red-800 transition-colors"
              >
                Clear
              </button>
            )}
            <a
              href="/products/demo-sku"
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Demo PDP
            </a>
          </div>
        </div>

        {isYaml && mockData && (mockData.snapshotDate || mockData.latencyDateRange) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
            {mockData.snapshotDate && (
              <span>Snapshot: <span className="text-zinc-400">{mockData.snapshotDate}</span></span>
            )}
            {mockData.latencyDateRange && (
              <span>Latency data: <span className="text-zinc-400">{mockData.latencyDateRange.from} — {mockData.latencyDateRange.to}</span></span>
            )}
          </div>
        )}

        {urlError && (
          <div className="p-3 bg-red-950/50 border border-red-800 rounded text-sm text-red-300">
            Failed to load YAML from URL: {urlError}
          </div>
        )}

        {/* Tab navigation — own row, horizontal only */}
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-zinc-800">
          <button
            onClick={() => setActiveTab("lcp")}
            className={`px-3 py-2 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === "lcp"
                ? "border-blue-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Suspense Waterfall
          </button>
          <button
            onClick={() => setActiveTab("tree")}
            className={`px-3 py-2 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === "tree"
                ? "border-blue-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Component Tree
          </button>
          <button
            onClick={() => setActiveTab("subgraphs")}
            className={`px-3 py-2 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === "subgraphs"
                ? "border-blue-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Subgraph Calls
          </button>
        </div>

        {/* Content */}
        <div className="bg-zinc-900/50 rounded-lg border border-zinc-800 p-2 md:p-4">
          {loading && !hasData ? (
            <div className="text-center py-12 text-zinc-500 animate-pulse">
              Loading metrics...
            </div>
          ) : !hasData ? (
            <div className="text-center py-12 text-zinc-500">
              <p>No metrics data yet.</p>
              <p className="text-sm mt-3">
                Visit the{" "}
                <a
                  href="/products/demo-sku"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  product page
                </a>{" "}
                and reload a couple of times to collect performance metrics,
              </p>
              <p className="text-sm mt-1">
                or{" "}
                <button
                  onClick={loadDemoData}
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  load demo data
                </button>{" "}
                to explore the dashboard with sample metrics.
              </p>
            </div>
          ) : activeTab === "lcp" ? (
            <CriticalInitPath
              pctl={pctl}
              mock={mockData!.waterfall}
            />
          ) : activeTab === "tree" ? (
            <BoundaryTreeTable
              pctl={pctl}
              mock={mockData!.tree}
            />
          ) : (
            <SubgraphCallsTab
              pctl={pctl}
              mock={mockData!.subgraphs}
              lcpSubgraphs={lcpSubgraphs}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 pt-2 pb-4">
          <YamlUpload onLoad={loadYamlData} />
          <button
            onClick={loadDemoData}
            className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            Demo
          </button>
        </div>
      </div>
    </div>
  );
}
