"use client";

import { useState, useEffect, useCallback } from "react";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { LcpCriticalPath } from "@/components/dashboard/LcpCriticalPath";
import { LoadGenerator } from "@/components/dashboard/LoadGenerator";
import type {
  BoundaryMetric,
  FetchMetric,
  QueryMetric,
  SubgraphOperationMetric,
} from "@/lib/metrics-store";

interface MetricsResponse {
  boundaries: BoundaryMetric[];
  fetches: FetchMetric[];
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  totalPageLoads: number;
}

const PERCENTILE_OPTIONS = [50, 75, 90, 95, 99] as const;

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<"tree" | "lcp">("tree");
  const [loading, setLoading] = useState(true);
  const [pctl, setPctl] = useState<number>(99);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/metrics");
      const data = await res.json();
      setMetrics(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-mono">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">
              Suspense Boundary Monitor
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              /products/[sku] &mdash;{" "}
              {metrics ? `${metrics.totalPageLoads} page loads` : "loading..."}
            </p>
          </div>
          <button
            onClick={fetchMetrics}
            className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Load Generator */}
        <LoadGenerator onComplete={fetchMetrics} />

        {/* Tab navigation + percentile selector */}
        <div className="flex items-center justify-between border-b border-zinc-800">
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
        <div className="bg-zinc-900/50 rounded-lg border border-zinc-800 p-4">
          {loading && !metrics ? (
            <div className="text-center py-12 text-zinc-500 animate-pulse">
              Loading metrics...
            </div>
          ) : activeTab === "tree" ? (
            <BoundaryTreeTable
              boundaries={metrics?.boundaries ?? []}
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
