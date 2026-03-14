"use client";

import { useState } from "react";

interface LoadGeneratorProps {
  onComplete: () => void;
}

export function LoadGenerator({ onComplete }: LoadGeneratorProps) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );
  const [count, setCount] = useState(100);
  const [result, setResult] = useState<{
    completed: number;
    requested: number;
  } | null>(null);

  async function generate() {
    setStatus("running");
    setResult(null);
    try {
      const res = await fetch("/api/generate-load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      setResult({ completed: data.completed, requested: data.requested });
      setStatus("done");
      onComplete();
    } catch {
      setStatus("error");
    }
  }

  async function clearMetrics() {
    await fetch("/api/metrics", { method: "DELETE" });
    setResult(null);
    setStatus("idle");
    onComplete();
  }

  return (
    <div className="flex items-center gap-4 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-400">Requests:</label>
        <input
          type="number"
          min={1}
          max={500}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          disabled={status === "running"}
          className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 font-mono"
        />
      </div>

      <button
        onClick={generate}
        disabled={status === "running"}
        className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
          status === "running"
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

      {status === "running" && (
        <span className="text-sm text-yellow-400 animate-pulse">
          Firing {count} requests...
        </span>
      )}
      {status === "done" && result && (
        <span className="text-sm text-green-400">
          {result.completed}/{result.requested} completed
        </span>
      )}
      {status === "error" && (
        <span className="text-sm text-red-400">Error generating load</span>
      )}
    </div>
  );
}
