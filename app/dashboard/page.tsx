"use client";

import { useState, useEffect, useCallback } from "react";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { CriticalInitPath } from "@/components/dashboard/CriticalInitPath";
import { SubgraphCallsTab } from "@/components/dashboard/SubgraphCallsTab";
import { clientMetricsStore, type ClientMetrics } from "@/lib/client-metrics-store";

const PERCENTILE_OPTIONS = [50, 75, 90, 95, 99] as const;

const PAGE_TYPES = [
  { value: "pdp", label: "PDP", route: "/products/[sku]", enabled: true },
  { value: "search", label: "Search Results", route: "/search", enabled: false },
  { value: "category", label: "Category Page", route: "/c/[slug]", enabled: false },
  { value: "checkout", label: "Checkout", route: "/checkout", enabled: false },
] as const;

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<ClientMetrics | null>(null);
  const [activeTab, setActiveTab] = useState<"lcp" | "tree" | "subgraphs">("lcp");
  const [loading, setLoading] = useState(true);
  const [pctl, setPctl] = useState<number>(99);
  const [pageType, setPageType] = useState("pdp");

  const currentPage = PAGE_TYPES.find((p) => p.value === pageType) ?? PAGE_TYPES[0];

  const refreshMetrics = useCallback(() => {
    setLoading(true);
    const data = clientMetricsStore.getMetrics();
    setMetrics(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    clientMetricsStore.seedIfFirstVisit().then(() => refreshMetrics());
  }, [refreshMetrics]);

  function clearMetrics() {
    clientMetricsStore.clear();
    refreshMetrics();
  }

  async function loadDemoData() {
    setLoading(true);
    await clientMetricsStore.loadSeedData();
    refreshMetrics();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8 md:px-6 md:py-12 font-mono overflow-x-hidden">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-white">
              Critical Initialization Path Dashboard
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1.5">
                <select
                  value={pageType}
                  onChange={(e) => setPageType(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-zinc-500"
                >
                  {PAGE_TYPES.map((pt) => (
                    <option key={pt.value} value={pt.value} disabled={!pt.enabled}>
                      {pt.label}{!pt.enabled ? " (coming soon)" : ""}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-zinc-500 truncate">
                  {currentPage.route} &mdash;{" "}
                  {metrics ? `${metrics.totalPageLoads} page loads` : "loading..."}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearMetrics}
              className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-red-300 hover:border-red-800 transition-colors flex-shrink-0"
            >
              Clear
            </button>
            <button
              onClick={refreshMetrics}
              className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors flex-shrink-0"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Tab navigation + percentile selector */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("lcp")}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === "lcp"
                  ? "border-blue-500 text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Critical Initialization Path
            </button>
            <button
              onClick={() => setActiveTab("tree")}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === "tree"
                  ? "border-blue-500 text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Component Boundary Tree
            </button>
            <button
              onClick={() => setActiveTab("subgraphs")}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === "subgraphs"
                  ? "border-blue-500 text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Subgraph Calls
            </button>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <span className="text-xs text-zinc-500">Percentile:</span>
            <select
              value={pctl}
              onChange={(e) => setPctl(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 font-mono focus:outline-none focus:border-zinc-500"
            >
              {PERCENTILE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  p{p}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Content */}
        <div className="bg-zinc-900/50 rounded-lg border border-zinc-800 p-2 md:p-4">
          {loading && !metrics ? (
            <div className="text-center py-12 text-zinc-500 animate-pulse">
              Loading metrics...
            </div>
          ) : metrics && metrics.totalPageLoads === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p>No metrics data yet.</p>
              <p className="text-sm mt-3">
                Visit the{" "}
                <a href="/products/demo-sku" className="text-blue-400 hover:text-blue-300 underline">
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
            />
          ) : activeTab === "tree" ? (
            <BoundaryTreeTable
              boundaries={metrics?.boundaries ?? []}
              queries={metrics?.queries ?? []}
              subgraphOps={metrics?.subgraphOps ?? []}
              pctl={pctl}
            />
          ) : (
            <SubgraphCallsTab
              queries={metrics?.queries ?? []}
              subgraphOps={metrics?.subgraphOps ?? []}
              pctl={pctl}
            />
          )}
        </div>
      </div>
    </div>
  );
}
