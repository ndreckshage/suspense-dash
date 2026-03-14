"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { LcpCriticalPath } from "@/components/dashboard/LcpCriticalPath";
import { SubgraphCallsTab } from "@/components/dashboard/SubgraphCallsTab";
import { LoadGenerator } from "@/components/dashboard/LoadGenerator";
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
  const [activeTab, setActiveTab] = useState<"tree" | "lcp" | "subgraphs">("tree");
  const [loading, setLoading] = useState(true);
  const [pctl, setPctl] = useState<number>(99);
  const [pageType, setPageType] = useState("pdp");
  const [slowMode, setSlowMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const currentPage = PAGE_TYPES.find((p) => p.value === pageType) ?? PAGE_TYPES[0];

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
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Slow Mode toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-zinc-500">Slow Mode</span>
              <button
                role="switch"
                aria-checked={slowMode}
                onClick={() => setSlowMode((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  slowMode ? "bg-amber-600" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    slowMode ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
            <button
              onClick={refreshMetrics}
              className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Slow Mode viewer */}
        {slowMode && (
          <div className="rounded-lg border border-amber-700/50 bg-zinc-900 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-amber-900/20 border-b border-amber-700/30">
              <span className="text-xs text-amber-400">
                Slow Mode &mdash; Watch boundaries resolve in real-time (no stats recorded)
              </span>
              <button
                onClick={() => setIframeKey((k) => k + 1)}
                className="px-3 py-1 text-xs bg-amber-700/30 text-amber-300 rounded hover:bg-amber-700/50 transition-colors"
              >
                Reload
              </button>
            </div>
            <iframe
              ref={iframeRef}
              key={iframeKey}
              src="/products/demo-sku?slow=1"
              className="w-full h-[600px] bg-zinc-950 border-0"
              title="Slow mode PDP preview"
            />
          </div>
        )}

        {/* Load Generator */}
        {!slowMode && <LoadGenerator onComplete={refreshMetrics} />}

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
              hydrationTimes={metrics?.hydrationTimes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
