"use client";

import { useMemo, useState, useCallback } from "react";
import type {
  QueryMetric,
  SubgraphOperationMetric,
} from "@/lib/metrics-store";
import { SUBGRAPHS, type SubgraphName } from "@/lib/gql-federation";
import { percentile } from "@/lib/percentile";
import type { MockSubgraphData } from "@/lib/mock-metrics";
import { buildSubgraphColorMap, DEFAULT_SUBGRAPH_COLOR } from "@/lib/subgraph-colors";
import { TabDescription } from "./TabDescription";
import { Tooltip } from "./Tooltip";

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

type SloFilter = "exceeded" | "noSlo" | "hasSlo" | null;
type SortField = "name" | "callsPerReq" | "duration" | "slo" | "status";
type SortDir = "asc" | "desc";

function getSloSortValue(row: SubgraphSummary): number {
  if (row.sloMs === 0) return -1; // no SLO sorts last
  const ratio = row.durationPctl / row.sloMs;
  if (ratio > 1) return 3;       // exceeded
  if (ratio > 0.8) return 2;     // warning
  return 1;                       // ok
}

export function SubgraphCallsTab({ queries, subgraphOps, pctl, mock }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sloFilter, setSloFilter] = useState<SloFilter>(null);
  const [sortField, setSortField] = useState<SortField>("callsPerReq");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortDir(field === "name" ? "asc" : "desc");
      }
      return field;
    });
  }, []);
  const toggleSloFilter = useCallback(
    (f: "exceeded" | "noSlo" | "hasSlo") => setSloFilter((prev) => (prev === f ? null : f)),
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


  // Dynamic color map based on subgraphs present in the data
  const subgraphColorMap = useMemo(() => {
    const names = new Set<string>();
    if (mock?.[pctl]) {
      for (const r of mock[pctl].rows) names.add(r.name);
    } else {
      for (const op of subgraphOps) names.add(op.subgraphName);
    }
    return buildSubgraphColorMap(names);
  }, [mock, pctl, subgraphOps]);

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
          sloMs: r.sloMs ?? 0,
          callers: [...callerMap.entries()].map(([key, c]) => ({
            ...c,
            durationPctl: percentile(callerDurations.get(key) ?? [], pctl),
          })),
          hasClientCalls: r.operations.length > 0 && r.operations.every((op) => op.isClient),
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
      const color = SUBGRAPHS[sgName as SubgraphName]?.color ?? subgraphColorMap.get(sgName) ?? DEFAULT_SUBGRAPH_COLOR;
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
        hasClientCalls: sgAllOps.length > 0 && sgAllOps.every((o) => o.phase === "csr"),
      });
    }

    subgraphRows.sort((a, b) => b.callsPerReq - a.callsPerReq);

    return { summary, subgraphRows };
  }, [subgraphOps, pctl, mock, subgraphColorMap]);

  if (subgraphRows.length === 0 && subgraphOps.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        No metrics data. Generate load to populate the dashboard.
      </div>
    );
  }

  const pLabel = `p${pctl}`;

  const filteredRows = useMemo(() => {
    let rows = subgraphRows;
    if (sloFilter === "exceeded") rows = rows.filter((r) => r.sloMs > 0 && r.durationPctl > r.sloMs);
    else if (sloFilter === "hasSlo") rows = rows.filter((r) => r.sloMs > 0);
    else if (sloFilter === "noSlo") rows = rows.filter((r) => r.sloMs === 0);

    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "callsPerReq":
          cmp = a.callsPerReq - b.callsPerReq;
          break;
        case "duration":
          cmp = a.durationPctl - b.durationPctl;
          break;
        case "slo":
          cmp = a.sloMs - b.sloMs;
          break;
        case "status":
          cmp = getSloSortValue(a) - getSloSortValue(b);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [subgraphRows, sloFilter, sortField, sortDir]);

  const sloCounts = useMemo(() => {
    const exceeded = subgraphRows.filter((r) => r.sloMs > 0 && r.durationPctl > r.sloMs).length;
    const noSlo = subgraphRows.filter((r) => r.sloMs === 0).length;
    const hasSlo = subgraphRows.filter((r) => r.sloMs > 0).length;
    return { exceeded, noSlo, hasSlo };
  }, [subgraphRows]);

  const expandAll = useCallback(() => {
    setExpanded(new Set(filteredRows.map((r) => r.name)));
  }, [filteredRows]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const maxCallsPerReq = Math.max(...filteredRows.map((r) => r.callsPerReq), 1);

  return (
    <div className="space-y-4">
      <TabDescription title="What does this measure?" storageKey="subgraphs">
        <p>
          This view counts how many times each backend service (subgraph) is called to render a single page
          load — <strong className="text-zinc-300">before any user interaction</strong> (scroll, click, tap).
          Only initialization traffic is included; lazy-loaded content triggered by scrolling is excluded.
        </p>
        <p>
          <strong className="text-zinc-300">Calls / request</strong> is the number of times this subgraph is
          hit per page load. Multiple boundaries may call the same service — expanding a row shows which
          queries and boundaries are responsible. High call counts may indicate an opportunity to optimize
          the query plan, including reviewing <strong className="text-zinc-300">@key</strong> usage across
          subgraphs to reduce entity resolution round-trips, or batching requests.
        </p>
        <p>
          <strong className="text-zinc-300">Duration</strong> is the response time at the selected percentile.
          Compare this against the <strong className="text-zinc-300">SLO</strong> column — if duration exceeds
          the SLO, the service is the bottleneck. Services without a defined SLO are flagged so teams can set one.
        </p>
      </TabDescription>
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
          SLO Exceeded ({sloCounts.exceeded})
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
          No SLO ({sloCounts.noSlo})
        </button>
        <button
          onClick={() => toggleSloFilter("hasSlo")}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            sloFilter === "hasSlo"
              ? "border-green-500 text-green-300 bg-green-500/10"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-green-400" />
          Has SLO ({sloCounts.hasSlo})
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
            <span className="text-zinc-500">Memoized: </span>
            <span className="text-cyan-500 font-medium">{summary.dedupedPerReq}</span>
          </div>
        )}
      </div>

      {/* Expand / Collapse controls */}
      <div className="flex gap-2">
        <button
          onClick={expandAll}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800"
        >
          Collapse All
        </button>
      </div>

      {/* Per-subgraph table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono table-fixed" style={{ minWidth: "500px" }}>
          <thead>
            <tr className="text-zinc-500 text-xs border-b border-zinc-800">
              <SortableHeader field="name" label="Subgraph" sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="left" style={{ width: "24%" }} />
              <SortableHeader field="callsPerReq" label="Calls/req" sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" style={{ width: "12%" }} />
              <SortableHeader field="duration" label="Duration" subLabel={pLabel} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" style={{ width: "12%" }} />
              <SortableHeader field="slo" label="SLO" sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" style={{ width: "10%" }} />
              <SortableHeader field="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="center" style={{ width: "8%" }} />
              <th className="py-2 px-2 font-normal text-left text-zinc-600" style={{ width: "34%" }}>
                Calls/req distribution
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
        row.callers.map((caller) => {
          const component = caller.boundary.split(".").pop() ?? "";
          const fullLabel = `${caller.queryName} → ${component}`;
          return (
          <tr
            key={`${caller.queryName}:${caller.boundary}`}
            className="border-b border-zinc-800/30 bg-zinc-900/50"
          >
            <td className="py-1 px-2" colSpan={2}>
              <Tooltip
                content={
                  <div className="flex items-center gap-1.5">
                    <span className="text-teal-400">{caller.queryName}</span>
                    <span className="text-zinc-500">&rarr;</span>
                    <span className="text-zinc-300">{component}</span>
                  </div>
                }
                className="flex items-center gap-1.5 pl-9 min-w-0"
              >
                <span className="text-zinc-600 flex-shrink-0">&#x2514;</span>
                <span className="text-teal-400 text-xs truncate max-w-[80px]">{caller.queryName}</span>
                <span className="text-zinc-600 text-xs flex-shrink-0">&rarr;</span>
                <span className="text-zinc-400 text-xs truncate max-w-[60px]">{component}</span>
                {caller.isClient && (
                  <span className="text-xs bg-purple-900/30 text-purple-400 rounded px-1 py-0.5 flex-shrink-0">
                    client
                  </span>
                )}
              </Tooltip>
            </td>
            <td className="text-right py-1 px-2 text-zinc-500 text-xs">
              {caller.durationPctl > 0 ? `${caller.durationPctl}ms` : ""}
            </td>
            <td colSpan={3} />
          </tr>
          );
        })}
    </>
  );
}

function SortableHeader({
  field,
  label,
  subLabel,
  sortField,
  sortDir,
  onSort,
  align,
  style,
}: {
  field: SortField;
  label: string;
  subLabel?: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  align: "left" | "right" | "center";
  style?: React.CSSProperties;
}) {
  const active = sortField === field;
  const arrow = active ? (sortDir === "asc" ? " \u25B4" : " \u25BE") : "";
  const textAlign = align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center";
  return (
    <th
      className={`${textAlign} py-2 px-2 font-normal cursor-pointer select-none hover:text-zinc-300 transition-colors ${active ? "text-zinc-300" : ""}`}
      style={style}
      onClick={() => onSort(field)}
    >
      {label}{arrow}
      {subLabel && (
        <>
          <br />
          <span className="text-zinc-600">{subLabel}</span>
        </>
      )}
    </th>
  );
}
