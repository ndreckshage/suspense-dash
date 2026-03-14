"use client";

import { useState, useCallback } from "react";
import { clientMetricsStore } from "@/lib/client-metrics-store";
import { simulateCsrQueries } from "@/lib/csr-simulation";

const MAX_TOTAL_PAGE_LOADS = 100;

interface LoadGeneratorProps {
  onComplete: () => void;
}

/**
 * Extracts embedded metrics from a product page HTML response.
 * The server embeds metrics in a <script type="application/json" id="__perf_metrics__"> tag
 * when the x-load-test header is present.
 *
 * Uses a loose regex that matches the id attribute regardless of attribute order,
 * since React may reorder attributes in different environments.
 */
function extractMetrics(html: string) {
  // Match script tag with id="__perf_metrics__" — allow attributes in any order
  const match = html.match(
    /<script[^>]*\bid="__perf_metrics__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function LoadGenerator({ onComplete }: LoadGeneratorProps) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle",
  );
  const [count, setCount] = useState(20);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    completed: number;
    requested: number;
    errors: number;
  } | null>(null);

  const generate = useCallback(async () => {
    setStatus("running");
    setResult(null);
    setProgress(0);

    try {
      const existing = clientMetricsStore.getPageLoadCount();
      const remaining = Math.max(0, MAX_TOTAL_PAGE_LOADS - existing);
      const actual = Math.min(count, remaining);

      if (actual === 0) {
        setResult({ completed: 0, requested: count, errors: 0 });
        setStatus("done");
        onComplete();
        return;
      }

      let completed = 0;
      let errors = 0;
      for (let i = 0; i < actual; i++) {
        try {
          const res = await fetch("/products/demo-sku", {
            cache: "no-store",
            headers: { "x-load-test": "true" },
          });
          const html = await res.text();
          const metrics = extractMetrics(html);

          if (metrics && metrics.boundaries?.length > 0) {
            clientMetricsStore.addPageLoad(metrics);

            // Simulate CSR queries for this page load
            const requestId = metrics.boundaries[0]?.requestId;
            const requestStartTs = metrics.boundaries[0]?.timestamp - metrics.boundaries[0]?.wall_start_ms;
            if (requestId) {
              // Estimate hydration offset: last SSR boundary end + small overhead
              const maxSsrEnd = Math.max(
                ...metrics.boundaries.map(
                  (b: { wall_start_ms: number; render_duration_ms: number }) =>
                    b.wall_start_ms + b.render_duration_ms,
                ),
              );
              const hydrationMs = maxSsrEnd + 50; // ~50ms hydration overhead
              const csrResult = await simulateCsrQueries(
                requestId,
                requestStartTs,
                hydrationMs,
              );
              clientMetricsStore.appendCsrMetrics(requestId, csrResult);
            }

            completed++;
          } else {
            errors++;
            if (errors === 1) {
              // Log first extraction failure for debugging
              const hasTag = html.includes("__perf_metrics__");
              const isRSC = html.startsWith("0:") || html.startsWith("1:");
              console.warn(
                "[LoadGenerator] Metrics extraction failed.",
                `Response length: ${html.length}`,
                `Has metrics tag: ${hasTag}`,
                `Is RSC payload: ${isRSC}`,
                `First 200 chars: ${html.substring(0, 200)}`,
              );
            }
          }
        } catch (err) {
          errors++;
          if (errors === 1) {
            console.warn("[LoadGenerator] Request failed:", err);
          }
        }

        setProgress(i + 1);
      }

      setResult({ completed, requested: count, errors });
      setStatus("done");
      onComplete();
    } catch {
      setStatus("error");
    }
  }, [count, onComplete]);

  function clearMetrics() {
    clientMetricsStore.clear();
    setResult(null);
    setProgress(0);
    setStatus("idle");
    onComplete();
  }

  const currentLoads =
    typeof window !== "undefined"
      ? clientMetricsStore.getPageLoadCount()
      : 0;
  const atCapacity = currentLoads >= MAX_TOTAL_PAGE_LOADS;

  return (
    <div className="flex flex-wrap items-center gap-3 md:gap-4 p-3 md:p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-400">Requests:</label>
        <input
          type="number"
          min={1}
          max={MAX_TOTAL_PAGE_LOADS}
          value={count}
          onChange={(e) =>
            setCount(
              Math.min(
                Math.max(Number(e.target.value) || 1, 1),
                MAX_TOTAL_PAGE_LOADS,
              ),
            )
          }
          disabled={status === "running"}
          className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 font-mono"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={generate}
          disabled={status === "running" || atCapacity}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            status === "running" || atCapacity
              ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-500"
          }`}
        >
          {status === "running" ? "Generating..." : "Generate Load"}
        </button>

        <button
          onClick={clearMetrics}
          disabled={status === "running"}
          className="px-4 py-1.5 rounded text-sm font-medium border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        >
          Clear
        </button>
      </div>

      {status === "running" && (
        <span className="text-sm text-yellow-400 animate-pulse">
          Firing requests... {progress}/{actual()}
        </span>
      )}
      {status === "done" && result && (
        <span className="text-sm text-green-400">
          {result.completed}/{result.requested} completed
          {result.errors > 0 && (
            <span className="text-yellow-400 ml-1">
              ({result.errors} failed — check console)
            </span>
          )}
          {result.completed < result.requested && result.errors === 0 && (
            <span className="text-zinc-500 ml-1">
              (capped at {MAX_TOTAL_PAGE_LOADS} total)
            </span>
          )}
        </span>
      )}
      {status === "error" && (
        <span className="text-sm text-red-400">Error generating load</span>
      )}
      {atCapacity && status !== "running" && status !== "done" && (
        <span className="text-sm text-zinc-500">
          At capacity ({MAX_TOTAL_PAGE_LOADS} loads). Clear to generate more.
        </span>
      )}
    </div>
  );

  function actual() {
    const existing = clientMetricsStore.getPageLoadCount();
    return Math.min(count, Math.max(0, MAX_TOTAL_PAGE_LOADS - existing));
  }
}
