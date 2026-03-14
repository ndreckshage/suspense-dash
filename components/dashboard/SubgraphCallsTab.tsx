"use client";

import { useMemo, useState, useCallback } from "react";
import type {
  QueryMetric,
  SubgraphOperationMetric,
} from "@/lib/metrics-store";
import { SUBGRAPHS, type SubgraphName } from "@/lib/gql-federation";
import { percentile } from "@/lib/percentile";

interface Props {
  queries: QueryMetric[];
  subgraphOps: SubgraphOperationMetric[];
  pctl: number;
}

interface SubgraphSummary {
  name: string;
  color: string;
  callsPerReq: number;
  durationPctl: number;
  operations: OperationDetail[];
}

interface OperationDetail {
  name: string;
  callsPerReq: number;
  durationPctl: number;
  boundaries: string[];
  queryNames: string[];
  isClient: boolean;
}

export function SubgraphCallsTab({ queries, subgraphOps, pctl }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const { summary, subgraphRows } = useMemo(() => {
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
    // Keep all ops (including cached) for the operation detail to show boundary/query info
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
      const sgAllOps = allBySubgraph.get(sgName) ?? [];

      // Per-operation detail
      const opsByName = new Map<string, SubgraphOperationMetric[]>();
      for (const op of sgAllOps) {
        const list = opsByName.get(op.operationName) ?? [];
        list.push(op);
        opsByName.set(op.operationName, list);
      }

      const operations: OperationDetail[] = [];
      for (const [opName, ops] of opsByName) {
        const uncachedOps = ops.filter((o) => !o.cached);
        const uncachedDurations = uncachedOps.map((o) => o.duration_ms);
        const boundarySet = new Set(ops.map((o) => o.boundary_path));
        const querySet = new Set(ops.map((o) => o.queryName));

        operations.push({
          name: opName,
          callsPerReq: Math.round((uncachedOps.length / numRequests) * 10) / 10,
          durationPctl: percentile(uncachedDurations, pctl),
          boundaries: [...boundarySet],
          queryNames: [...querySet],
          isClient: ops.some((o) => o.phase === "csr"),
        });
      }

      operations.sort((a, b) => b.callsPerReq - a.callsPerReq);

      const durations = sgUncachedOps.map((o) => o.duration_ms);

      subgraphRows.push({
        name: sgName,
        color,
        callsPerReq: Math.round((sgUncachedOps.length / numRequests) * 10) / 10,
        durationPctl: percentile(durations, pctl),
        operations,
      });
    }

    subgraphRows.sort((a, b) => b.callsPerReq - a.callsPerReq);

    return { summary, subgraphRows };
  }, [subgraphOps, pctl]);

  if (subgraphOps.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        No metrics data. Generate load to populate the dashboard.
      </div>
    );
  }

  const pLabel = `p${pctl}`;
  const maxCallsPerReq = Math.max(...subgraphRows.map((r) => r.callsPerReq), 1);

  return (
    <div className="space-y-4">
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
              <th className="text-left py-2 px-2 font-normal" style={{ width: "28%" }}>Subgraph</th>
              <th className="text-right py-2 px-2 font-normal" style={{ width: "14%" }}>
                Calls/req
              </th>
              <th className="text-right py-2 px-2 font-normal" style={{ width: "14%" }}>
                Duration
                <br />
                <span className="text-zinc-600">{pLabel}</span>
              </th>
              <th className="py-2 px-2 font-normal" style={{ width: "44%" }}>
                <span className="sr-only">Distribution</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {subgraphRows.map((row) => {
              const isExpanded = expanded.has(row.name);
              return (
                <SubgraphRow
                  key={row.name}
                  row={row}
                  isExpanded={isExpanded}
                  maxCallsPerReq={maxCallsPerReq}
                  pLabel={pLabel}
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
  maxCallsPerReq,
  pLabel,
  onToggle,
}: {
  row: SubgraphSummary;
  isExpanded: boolean;
  maxCallsPerReq: number;
  pLabel: string;
  onToggle: () => void;
}) {
  const barWidth = Math.max(2, (row.callsPerReq / maxCallsPerReq) * 100);

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
          </div>
        </td>
        <td className="text-right py-1.5 px-2 text-zinc-300 font-medium">{row.callsPerReq}</td>
        <td className="text-right py-1.5 px-2 text-zinc-300">{row.durationPctl}ms</td>
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
        row.operations.map((op) => (
          <tr key={op.name} className="border-b border-zinc-800/30 bg-zinc-900/50">
            <td className="py-1 px-2">
              <div className="flex items-center gap-1.5 pl-9">
                <span className="text-zinc-600">&#x2514;</span>
                <span className="text-zinc-400">{op.name}</span>
                {op.isClient && (
                  <span className="text-xs bg-purple-900/30 text-purple-400 rounded px-1 py-0.5">
                    client
                  </span>
                )}
              </div>
            </td>
            <td className="text-right py-1 px-2 text-zinc-400">{op.callsPerReq}</td>
            <td className="text-right py-1 px-2 text-zinc-400">{op.durationPctl}ms</td>
            <td className="py-1 px-2">
              <div className="flex flex-wrap gap-1">
                {op.queryNames.map((qn) => (
                  <span
                    key={qn}
                    className="text-xs bg-teal-900/30 text-teal-600 rounded px-1.5 py-0.5"
                    title={`Query: ${qn}`}
                  >
                    {qn}
                  </span>
                ))}
                {op.boundaries.map((bp) => (
                  <span
                    key={bp}
                    className="text-xs bg-zinc-800 text-zinc-500 rounded px-1.5 py-0.5"
                    title={`Boundary: ${bp}`}
                  >
                    {bp.split(".").pop()}
                  </span>
                ))}
              </div>
            </td>
          </tr>
        ))}
    </>
  );
}
