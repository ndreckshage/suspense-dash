"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { BoundaryTreeTable } from "@/components/dashboard/BoundaryTreeTable";
import { CriticalInitPath } from "@/components/dashboard/CriticalInitPath";
import { SubgraphCallsTab } from "@/components/dashboard/SubgraphCallsTab";
import { clientMetricsStore, type ClientMetrics } from "@/lib/client-metrics-store";

const PERCENTILE_OPTIONS = [50, 75, 90, 95, 99] as const;

const TAB_KEYS = ["lcp", "tree", "subgraphs"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const PAGE_TYPES = [
  { value: "pdp", label: "PDP", route: "/products/[sku]", enabled: true },
  { value: "search", label: "Search Results", route: "/search", enabled: false },
  { value: "category", label: "Category Page", route: "/c/[slug]", enabled: false },
  { value: "checkout", label: "Checkout", route: "/checkout", enabled: false },
] as const;

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8 md:px-6 md:py-12 font-mono">
          <div className="max-w-7xl mx-auto">
            <div className="text-center py-12 text-zinc-500 animate-pulse">Loading dashboard...</div>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [metrics, setMetrics] = useState<ClientMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [pctl, setPctl] = useState<number>(99);
  const [pageType, setPageType] = useState("pdp");

  // Read active tab from URL, default to "lcp"
  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = TAB_KEYS.includes(tabParam as TabKey)
    ? (tabParam as TabKey)
    : "lcp";

  const setActiveTab = useCallback(
    (tab: TabKey) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "lcp") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

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
            <h1 className="text-base md:text-xl font-bold text-white">
              Critical Path Dash
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <select
                value={pageType}
                onChange={(e) => setPageType(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-zinc-500 w-16"
              >
                {PAGE_TYPES.map((pt) => (
                  <option key={pt.value} value={pt.value} disabled={!pt.enabled}>
                    {pt.label}{!pt.enabled ? " (coming soon)" : ""}
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
                {currentPage.route} &mdash;{" "}
                {metrics ? `${metrics.totalPageLoads} loads` : "loading..."}
              </span>
              <span className="text-xs text-zinc-500 truncate sm:hidden">
                {metrics ? `${metrics.totalPageLoads} loads` : "loading..."}
              </span>
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

        {/* Tab navigation — own row, horizontal only */}
        <div className="flex gap-1 overflow-x-auto border-b border-zinc-800">
          <button
            onClick={() => setActiveTab("lcp")}
            className={`px-3 py-2 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === "lcp"
                ? "border-blue-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Critical Path
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

        {/* Link to PDP */}
        <div className="text-center pt-2 pb-4">
          <a
            href="/products/demo-sku"
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            View Product Page &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
