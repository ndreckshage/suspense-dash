"use client";

import { useState, useEffect, useCallback } from "react";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { CriticalInitPath } from "@/components/dashboard/CriticalInitPath";
import { SubgraphCallsTab } from "@/components/dashboard/SubgraphCallsTab";
import { clientMetricsStore, type ClientMetrics } from "@/lib/client-metrics-store";

const PERCENTILE_OPTIONS = [50, 75, 90, 95, 99] as const;

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<ClientMetrics | null>(null);
  const [activeTab, setActiveTab] = useState<"lcp" | "tree" | "subgraphs">("lcp");
  const [loading, setLoading] = useState(true);
  const [pctl, setPctl] = useState<number>(99);

  const refreshMetrics = useCallback(() => {
    setLoading(true);
    const data = clientMetricsStore.getMetrics();
    setMetrics(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshMetrics();
  }, [refreshMetrics]);

  function clearMetrics() {
    clientMetricsStore.clear();
    refreshMetrics();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-6 font-mono overflow-x-hidden">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-white">
              Suspense Boundary Monitor
            </h1>
            <p className="text-xs md:text-sm text-zinc-500 mt-1 truncate">
              /products/[sku] &mdash;{" "}
              {metrics ? `${metrics.totalPageLoads} page loads` : "loading..."}
            </p>
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
              <p className="text-sm mt-2">
                Visit the{" "}
                <a href="/products/demo-sku" className="text-blue-400 hover:text-blue-300 underline">
                  product page
                </a>{" "}
                and reload a couple of times to collect performance metrics.
              </p>
              <p className="text-xs mt-1 text-zinc-600">
                Metrics are automatically captured on each page load and stored in your browser (localStorage).
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
