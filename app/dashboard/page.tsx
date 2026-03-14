"use client";

import { useState, useEffect, useCallback } from "react";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { LcpCriticalPath } from "@/components/dashboard/LcpCriticalPath";
import { LoadGenerator } from "@/components/dashboard/LoadGenerator";
import type { BoundaryMetric, FetchMetric } from "@/lib/metrics-store";

interface MetricsResponse {
  boundaries: BoundaryMetric[];
  fetches: FetchMetric[];
  totalPageLoads: number;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<"tree" | "lcp">("tree");
  const [loading, setLoading] = useState(true);

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

        {/* Tab navigation */}
        <div className="flex gap-1 border-b border-zinc-800">
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

        {/* Content */}
        <div className="bg-zinc-900/50 rounded-lg border border-zinc-800 p-4">
          {loading && !metrics ? (
            <div className="text-center py-12 text-zinc-500 animate-pulse">
              Loading metrics...
            </div>
          ) : activeTab === "tree" ? (
            <BoundaryTreeTable
              boundaries={metrics?.boundaries ?? []}
              fetches={metrics?.fetches ?? []}
            />
          ) : (
            <LcpCriticalPath
              boundaries={metrics?.boundaries ?? []}
              fetches={metrics?.fetches ?? []}
            />
          )}
        </div>
      </div>
    </div>
  );
}
