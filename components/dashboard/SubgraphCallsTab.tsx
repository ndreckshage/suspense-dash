"use client";

import { useMemo, useState, useCallback } from "react";
import type {
  QueryMetric,
  SubgraphOperationMetric,
} from "@/lib/metrics-store";
import { SUBGRAPHS, type SubgraphName } from "@/lib/gql-federation";
import { percentile } from "@/lib/percentile";
import type { MockSubgraphData } from "@/lib/mock-metrics";

interface Props {
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  pctl: number;
  /** Pre-computed mock data keyed by percentile */
  mock?: Record<number, MockSubgraphData>;
}

interface CallerDetail {
  queryName: string;
  boundary: string;
  isClient: boolean;
  durationPctl: number;
}

interface SubgraphSummary {
  name: string;
  color: string;
  callsPerReq: number;
  durationPctl: number;
  sloMs: number;
  callers: CallerDetail[];
  hasClientCalls: boolean;
}

type SloFilter = "exceeded" | "noSlo" | null;

export function SubgraphCallsTab({ queries, subgraphOps, pctl, mock }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sloFilter, setSloFilter] = useState<SloFilter>(null);
  const toggleSloFilter = useCallback(
    (f: "exceeded" | "noSlo") => setSloFilter((prev) => (prev === f ? null : f)),
    [],
  );

  const toggleExpand = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const { summary, subgraphRows } = useMemo(() => {
    // Mock data path — use pre-computed values directly
    if (mock?.[pctl]) {
      const rows: SubgraphSummary[] = mock[pctl].rows.map((r) => {
        // Build callers from mock operation details, collecting durations per caller
        const callerDurations = new Map<string, number[]>();
        const callerMap = new Map<string, Omit<CallerDetail, "durationPctl">>();
        for (const op of r.operations) {
          for (let i = 0; i < op.queryNames.length; i++) {
            const qn = op.queryNames[i];
            const bp = op.boundaries[i] ?? op.boundaries[0] ?? "";
            const key = `${qn}:${bp}`;
            if (!callerMap.has(key)) {
              callerMap.set(key, { queryName: qn, boundary: bp, isClient: op.isClient });
            }
            const durations = callerDurations.get(key) ?? [];
            durations.push(op.durationPctl);
            callerDurations.set(key, durations);
          }
        }
        return {
          name: r.name,
          color: r.color,
          callsPerReq: r.callsPerReq,
          durationPctl: r.durationPctl,
          sloMs: SUBGRAPHS[r.name as SubgraphName]?.sloMs ?? 0,
          callers: [...callerMap.entries()].map(([key, c]) => ({
            ...c,
            durationPctl: percentile(callerDurations.get(key) ?? [], pctl),
          })),
          hasClientCalls: r.operations.some((op) => op.isClient),
        };
      });
      return { summary: mock[pctl].summary, subgraphRows: rows };
    }

    if (subgraphOps.length === 0) {
      return { summary: { ssrCallsPerReq: 0, csrCallsPerReq: 0, dedupedPerReq: 0 }, subgraphRows: [] };
    }

    const requestIds = new Set(subgraphOps.map((o) => o.requestId));
    const numRequests = requestIds.size;

    // Count uncached (actual network calls) and cached (deduped) ops, split by phase
    let ssrUncached = 0;
    let csrUncached = 0;
    let totalCached = 0;
    for (const op of subgraphOps) {
      if (op.cached) totalCached++;
      else if (op.phase === "csr") csrUncached++;
      else ssrUncached++;
    }

    const summary = {
      ssrCallsPerReq: Math.round((ssrUncached / numRequests) * 10) / 10,
      csrCallsPerReq: Math.round((csrUncached / numRequests) * 10) / 10,
      dedupedPerReq: Math.round((totalCached / numRequests) * 10) / 10,
    };

    // Group uncached ops by subgraph
    const uncachedBySubgraph = new Map<string, SubgraphOperationMetric[]>();
    const allBySubgraph = new Map<string, SubgraphOperationMetric[]>();
    for (const op of subgraphOps) {
      const allList = allBySubgraph.get(op.subgraphName) ?? [];
      allList.push(op);
      allBySubgraph.set(op.subgraphName, allList);

      if (!op.cached) {
        const list = uncachedBySubgraph.get(op.subgraphName) ?? [];
        list.push(op);
        uncachedBySubgraph.set(op.subgraphName, list);
      }
    }

    const subgraphRows: SubgraphSummary[] = [];

    for (const [sgName, sgUncachedOps] of uncachedBySubgraph) {
      const color = SUBGRAPHS[sgName as SubgraphName]?.color ?? "rgb(161, 161, 170)";
      const sloMs = SUBGRAPHS[sgName as SubgraphName]?.sloMs ?? 0;
      const sgAllOps = allBySubgraph.get(sgName) ?? [];

      // Build unique callers (query + boundary pairs) with per-caller durations
      const callerBase = new Map<string, Omit<CallerDetail, "durationPctl">>();
      const callerDurations = new Map<string, number[]>();
      for (const op of sgAllOps) {
        const key = `${op.queryName}:${op.boundary_path}`;
        if (!callerBase.has(key)) {
          callerBase.set(key, {
            queryName: op.queryName,
            boundary: op.boundary_path,
            isClient: op.phase === "csr",
          });
        }
        if (!op.cached) {
          const durs = callerDurations.get(key) ?? [];
          durs.push(op.duration_ms);
          callerDurations.set(key, durs);
        }
      }

      const durations = sgUncachedOps.map((o) => o.duration_ms);

      subgraphRows.push({
        name: sgName,
        color,
        callsPerReq: Math.round((sgUncachedOps.length / numRequests) * 10) / 10,
        durationPctl: percentile(durations, pctl),
        sloMs,
        callers: [...callerBase.entries()].map(([key, c]) => ({
          ...c,
          durationPctl: percentile(callerDurations.get(key) ?? [], pctl),
        })),
        hasClientCalls: sgAllOps.some((o) => o.phase === "csr"),
      });
    }

    subgraphRows.sort((a, b) => b.callsPerReq - a.callsPerReq);

    return { summary, subgraphRows };
  }, [subgraphOps, pctl, mock]);

  if (subgraphRows.length === 0 && subgraphOps.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        No metrics data. Generate load to populate the dashboard.
      </div>
    );
  }

  const pLabel = `p${pctl}`;

  const filteredRows = useMemo(() => {
    if (!sloFilter) return subgraphRows;
    if (sloFilter === "exceeded") return subgraphRows.filter((r) => r.sloMs > 0 && r.durationPctl > r.sloMs);
    return subgraphRows.filter((r) => r.sloMs === 0); // noSlo
  }, [subgraphRows, sloFilter]);

  const maxCallsPerReq = Math.max(...filteredRows.map((r) => r.callsPerReq), 1);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
        <span className="text-zinc-600 mr-1">Filter:</span>
        <button
          onClick={() => toggleSloFilter("exceeded")}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            sloFilter === "exceeded"
              ? "border-red-500 text-red-300 bg-red-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-400" />
          SLO Exceeded
        </button>
        <button
          onClick={() => toggleSloFilter("noSlo")}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            sloFilter === "noSlo"
              ? "border-amber-500 text-amber-300 bg-amber-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-amber-400" />
          No SLO
        </button>
        {sloFilter && (
          <button
            onClick={() => setSloFilter(null)}
            className="text-zinc-500 hover:text-zinc-300 ml-2 underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <span className="text-zinc-500">SSR calls / request: </span>
          <span className="text-white font-medium">{summary.ssrCallsPerReq}</span>
        </div>
        {summary.csrCallsPerReq > 0 && (
          <div>
            <span className="text-zinc-500">CSR calls / request: </span>
            <span className="text-purple-400 font-medium">{summary.csrCallsPerReq}</span>
          </div>
        )}
        {summary.dedupedPerReq > 0 && (
          <div>
            <span className="text-zinc-500">Saved by dedup: </span>
            <span className="text-cyan-500 font-medium">{summary.dedupedPerReq}</span>
          </div>
        )}
      </div>

      {/* Per-subgraph table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono table-fixed" style={{ minWidth: "500px" }}>
          <thead>
            <tr className="text-zinc-500 text-xs border-b border-zinc-800">
              <th className="text-left py-2 px-2 font-normal" style={{ width: "24%" }}>Subgraph</th>
              <th className="text-right py-2 px-2 font-normal" style={{ width: "12%" }}>
                Calls/req
              </th>
              <th className="text-right py-2 px-2 font-normal" style={{ width: "12%" }}>
                Duration
                <br />
                <span className="text-zinc-600">{pLabel}</span>
              </th>
              <th className="text-right py-2 px-2 font-normal" style={{ width: "10%" }}>SLO</th>
              <th className="text-center py-2 px-2 font-normal" style={{ width: "8%" }}>Status</th>
              <th className="py-2 px-2 font-normal" style={{ width: "34%" }}>
                <span className="sr-only">Distribution</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const isExpanded = expanded.has(row.name);
              const hasSlo = row.sloMs > 0;
              const sloRatio = hasSlo ? row.durationPctl / row.sloMs : 0;
              const statusColor = !hasSlo
                ? "text-amber-500"
                : sloRatio > 1
                  ? "text-red-400"
                  : sloRatio > 0.8
                    ? "text-yellow-400"
                    : "text-green-400";
              const statusIcon = !hasSlo
                ? "?"
                : sloRatio > 1
                  ? "!!!"
                  : sloRatio > 0.8
                    ? "!!"
                    : "OK";
              const barWidth = Math.max(2, (row.callsPerReq / maxCallsPerReq) * 100);

              return (
                <SubgraphRow
                  key={row.name}
                  row={row}
                  isExpanded={isExpanded}
                  barWidth={barWidth}
                  hasSlo={hasSlo}
                  statusColor={statusColor}
                  statusIcon={statusIcon}
                  onToggle={() => toggleExpand(row.name)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubgraphRow({
  row,
  isExpanded,
  barWidth,
  hasSlo,
  statusColor,
  statusIcon,
  onToggle,
}: {
  row: SubgraphSummary;
  isExpanded: boolean;
  barWidth: number;
  hasSlo: boolean;
  statusColor: string;
  statusIcon: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="py-1.5 px-2">
          <div className="flex items-center gap-2">
            <button className="text-zinc-500 hover:text-zinc-300 w-4 text-center flex-shrink-0">
              {isExpanded ? "\u25BE" : "\u25B8"}
            </button>
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-zinc-200">{row.name.replace("-subgraph", "")}</span>
            {row.hasClientCalls && (
              <span className="text-xs bg-purple-900/30 text-purple-400 rounded px-1 py-0.5">
                client
              </span>
            )}
          </div>
        </td>
        <td className="text-right py-1.5 px-2 text-zinc-300 font-medium">{row.callsPerReq}</td>
        <td className="text-right py-1.5 px-2 text-zinc-300">{row.durationPctl}ms</td>
        <td className={`text-right py-1.5 px-2 ${hasSlo ? "text-zinc-500" : "text-amber-500/70 italic"}`}>
          {hasSlo ? `${row.sloMs}ms` : "none"}
        </td>
        <td className={`text-center py-1.5 px-2 ${statusColor}`}>
          {statusIcon}
        </td>
        <td className="py-1.5 px-2">
          <div className="flex items-center h-4">
            <div
              className="h-2.5 rounded-sm"
              style={{
                width: `${barWidth}%`,
                backgroundColor: row.color,
                minWidth: "4px",
              }}
            />
          </div>
        </td>
      </tr>
      {isExpanded &&
        row.callers.map((caller) => (
          <tr
            key={`${caller.queryName}:${caller.boundary}`}
            className="border-b border-zinc-800/30 bg-zinc-900/50"
          >
            <td className="py-1 px-2" colSpan={2}>
              <div className="flex items-center gap-1.5 pl-9">
                <span className="text-zinc-600">&#x2514;</span>
                <span className="text-teal-400 text-xs">{caller.queryName}</span>
                <span className="text-zinc-600 text-xs">&rarr;</span>
                <span className="text-zinc-400 text-xs">{caller.boundary.split(".").pop()}</span>
                {caller.isClient && (
                  <span className="text-xs bg-purple-900/30 text-purple-400 rounded px-1 py-0.5">
                    client
                  </span>
                )}
              </div>
            </td>
            <td className="text-right py-1 px-2 text-zinc-500 text-xs">
              {caller.durationPctl > 0 ? `${caller.durationPctl}ms` : ""}
            </td>
            <td colSpan={3} />
          </tr>
        ))}
    </>
  );
}
