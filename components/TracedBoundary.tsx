import { Suspense } from "react";
import { getRequestContext } from "@/lib/boundary-context";
import { metricsStore } from "@/lib/metrics-store";
import { busyWait } from "@/lib/busy-wait";

/** Mutable ref that render functions write to, recording when fetch I/O actually completed */
export interface FetchEndRef {
  ts: number;
}

interface TracedBoundaryProps {
  name: string;
  boundaryPath: string;
  render: (fetchEndRef: FetchEndRef) => Promise<React.ReactNode>;
  fallback?: React.ReactNode;
  lcpCritical?: boolean;
  route?: string;
  /** Simulated sync render cost in ms. Blocks the Node.js thread after the
   *  async fetch completes, modeling expensive JSX→HTML serialization. */
  renderCostMs?: number;
}

/**
 * Core instrumentation wrapper for suspense boundaries.
 *
 * Wraps an async render function in <Suspense> and measures:
 * - fetch_duration_ms: async I/O time (non-blocking, can overlap)
 * - render_cost_ms: sync CPU time (blocks thread, serializes with other boundaries)
 * - blocked_ms: time waiting for thread after fetch resolved
 * - render_duration_ms: total (fetch + blocked + render cost)
 * - wall_start_ms: time from request start to when this boundary begins executing
 *
 * Usage:
 *   <TracedBoundary
 *     name="nav"
 *     boundaryPath="shell.nav"
 *     renderCostMs={80}
 *     fallback={<NavSkeleton />}
 *     render={async () => {
 *       const data = await tracedFetch('nav-config', fetchFn, 'shell.nav');
 *       return <NavBar data={data} />;
 *     }}
 *   />
 */
export function TracedBoundary({
  name,
  boundaryPath,
  render,
  fallback,
  lcpCritical,
  route,
  renderCostMs,
}: TracedBoundaryProps) {
  return (
    <Suspense
      fallback={
        fallback ?? (
          <div className="animate-pulse bg-zinc-800/50 rounded h-16 m-2" />
        )
      }
    >
      <TracedBoundaryInner
        name={name}
        boundaryPath={boundaryPath}
        render={render}
        lcpCritical={lcpCritical}
        route={route}
        renderCostMs={renderCostMs}
      />
    </Suspense>
  );
}

async function TracedBoundaryInner({
  boundaryPath,
  render,
  lcpCritical,
  route = "/products/[sku]",
  renderCostMs = 0,
}: Omit<TracedBoundaryProps, "fallback">) {
  const ctx = getRequestContext();
  const wallStart = Date.now() - ctx.requestStartTs;
  const renderStart = Date.now();

  // Phase 1: async fetch + JSX creation (non-blocking I/O)
  // The render function writes to fetchEndRef.ts right after the fetch I/O
  // completes. This lets us measure the true I/O duration vs time waiting
  // for the thread (which inflates the apparent fetch time).
  const fetchEndRef: FetchEndRef = { ts: 0 };
  const content = await render(fetchEndRef);
  const continuationStart = Date.now();
  const fetchIoEnd = fetchEndRef.ts || continuationStart;
  const fetchDuration = fetchIoEnd - renderStart;

  // Phase 2: sync CPU rendering (blocks the Node.js thread)
  busyWait(renderCostMs);
  const syncEnd = Date.now();

  // blocked_ms = time between fetch I/O completing and this boundary
  // getting the thread. If another boundary's busyWait was running,
  // this will be positive.
  const blockedMs = Math.max(0, continuationStart - fetchIoEnd);
  const actualRenderCost = syncEnd - continuationStart;
  const totalDuration = syncEnd - renderStart;

  metricsStore.recordBoundary({
    timestamp: Date.now(),
    requestId: ctx.requestId,
    route,
    boundary_path: boundaryPath,
    wall_start_ms: wallStart,
    render_duration_ms: totalDuration,
    fetch_duration_ms: fetchDuration,
    render_cost_ms: actualRenderCost,
    blocked_ms: blockedMs,
    is_lcp_critical: lcpCritical ?? false,
  });

  return <>{content}</>;
}
