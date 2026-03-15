"use client";

import { useState, useEffect, useCallback } from "react";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { CriticalInitPath } from "@/components/dashboard/CriticalInitPath";
import { SubgraphCallsTab } from "@/components/dashboard/SubgraphCallsTab";
import {
  clientMetricsStore,
  type ClientMetrics,
} from "@/lib/client-metrics-store";
import type { MockDashboardData } from "@/lib/mock-metrics";
import { YamlUpload } from "@/components/dashboard/YamlUpload";

const PERCENTILE_OPTIONS = [50, 75, 90, 95, 99] as const;

const TAB_KEYS = ["lcp", "tree", "subgraphs"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const PAGE_TYPES = [
  { value: "pdp", label: "PDP", route: "/products/[sku]", enabled: true },
  {
    value: "search",
    label: "Search Results",
    route: "/search",
    enabled: false,
  },
  {
    value: "category",
    label: "Category Page",
    route: "/c/[slug]",
    enabled: false,
  },
  { value: "checkout", label: "Checkout", route: "/checkout", enabled: false },
] as const;

export function DashboardClient({ initialTab }: { initialTab: TabKey }) {
  const [metrics, setMetrics] = useState<ClientMetrics | null>(null);
  const [mockData, setMockData] = useState<MockDashboardData | null>(null);
  const [activeTab, setActiveTabState] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(true);
  const [pctl, setPctl] = useState<number>(99);
  const [pageType, setPageType] = useState("pdp");

  const setActiveTab = useCallback((tab: TabKey) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === "lcp") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    window.history.replaceState({}, "", url.toString());
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

  const currentPage =
    PAGE_TYPES.find((p) => p.value === pageType) ?? PAGE_TYPES[0];

  const refreshMetrics = useCallback(() => {
    setLoading(true);
    setMockData(null);
    const data = clientMetricsStore.getMetrics();
    setMetrics(data);
    setLoading(false);
  }, []);

  const loadMockData = useCallback((data: MockDashboardData) => {
    setMockData(data);
    setMetrics(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    clientMetricsStore.seedIfFirstVisit().then(() => refreshMetrics());
  }, [refreshMetrics]);

  function clearMetrics() {
    clientMetricsStore.clear();
    setMockData(null);
    refreshMetrics();
  }

  async function loadDemoData() {
    setLoading(true);
    setMockData(null);
    await clientMetricsStore.loadSeedData();
    refreshMetrics();
  }

  const isMock = mockData !== null;
  const hasData = isMock || (metrics !== null && metrics.totalPageLoads > 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8 md:px-6 md:py-12 font-mono overflow-x-hidden">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-base md:text-xl font-bold text-white">
                Suspense Dash
              </h1>
              {isMock && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 border border-blue-800 text-blue-300">
                  YAML
                </span>
              )}
              <a
                href="/products/demo-sku"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                View Demo
              </a>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <select
                value={pageType}
                onChange={(e) => setPageType(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-zinc-500 w-16"
              >
                {PAGE_TYPES.map((pt) => (
                  <option
                    key={pt.value}
                    value={pt.value}
                    disabled={!pt.enabled}
                  >
                    {pt.label}
                    {!pt.enabled ? " (coming soon)" : ""}
                  </option>
                ))}
              </select>
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
                {isMock
                  ? `${mockData.route} — YAML mock`
                  : `${currentPage.route} — ${metrics ? `${metrics.totalPageLoads} loads` : "loading..."}`}
              </span>
              <span className="text-xs text-zinc-500 truncate sm:hidden">
                {isMock
                  ? "YAML mock"
                  : metrics ? `${metrics.totalPageLoads} loads` : "loading..."}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <YamlUpload onLoad={loadMockData} />
            <button
              onClick={loadDemoData}
              className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors flex-shrink-0"
            >
              Demo
            </button>
            <button
              onClick={clearMetrics}
              className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-red-300 hover:border-red-800 transition-colors flex-shrink-0"
            >
              Clear
            </button>
          </div>
        </div>

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
            Suspense Path
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
              boundaries={metrics?.boundaries ?? []}
              queries={metrics?.queries ?? []}
              pctl={pctl}
              hydrationTimes={metrics?.hydrationTimes}
              loafEntries={metrics?.loafEntries}
              navigationTimings={metrics?.navigationTimings}
              mock={mockData?.waterfall}
            />
          ) : activeTab === "tree" ? (
            <BoundaryTreeTable
              boundaries={metrics?.boundaries ?? []}
              queries={metrics?.queries ?? []}
              subgraphOps={metrics?.subgraphOps ?? []}
              pctl={pctl}
              mock={mockData?.tree}
            />
          ) : (
            <SubgraphCallsTab
              queries={metrics?.queries ?? []}
              subgraphOps={metrics?.subgraphOps ?? []}
              pctl={pctl}
              mock={mockData?.subgraphs}
            />
          )}
        </div>

        {/* Link to PDP */}
        <div className="text-center pt-2 pb-4">
          <a
            href="/products/demo-sku"
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            View Demo &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
