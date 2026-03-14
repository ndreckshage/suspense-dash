"use client";

import { useState, useEffect, useCallback } from "react";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { LcpCriticalPath } from "@/components/dashboard/LcpCriticalPath";
import { SubgraphCallsTab } from "@/components/dashboard/SubgraphCallsTab";
import { LoadGenerator } from "@/components/dashboard/LoadGenerator";
import { clientMetricsStore, type ClientMetrics } from "@/lib/client-metrics-store";

const PERCENTILE_OPTIONS = [50, 75, 90, 95, 99] as const;

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<ClientMetrics | null>(null);
  const [activeTab, setActiveTab] = useState<"tree" | "lcp" | "subgraphs">("tree");
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
          <button
            onClick={refreshMetrics}
            className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors flex-shrink-0"
          >
            Refresh
          </button>
        </div>

        {/* Load Generator */}
        <LoadGenerator onComplete={refreshMetrics} />

        {/* Tab navigation + percentile selector */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("tree")}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === "tree"
                  ? "border-blue-500 text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Boundary Tree
            </button>
            <button
              onClick={() => setActiveTab("lcp")}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === "lcp"
                  ? "border-blue-500 text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              LCP Critical Path
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
                Click <span className="text-blue-400">Generate Load</span> above to fire requests
                to the product page and collect performance metrics.
              </p>
              <p className="text-xs mt-1 text-zinc-600">
                Metrics are stored in your browser (localStorage) and persist between reloads.
              </p>
            </div>
          ) : activeTab === "tree" ? (
            <BoundaryTreeTable
              boundaries={metrics?.boundaries ?? []}
              queries={metrics?.queries ?? []}
              subgraphOps={metrics?.subgraphOps ?? []}
              pctl={pctl}
            />
          ) : activeTab === "subgraphs" ? (
            <SubgraphCallsTab
              queries={metrics?.queries ?? []}
              subgraphOps={metrics?.subgraphOps ?? []}
              pctl={pctl}
            />
          ) : (
            <LcpCriticalPath
              boundaries={metrics?.boundaries ?? []}
              queries={metrics?.queries ?? []}
              pctl={pctl}
            />
          )}
        </div>
      </div>
    </div>
  );
}
