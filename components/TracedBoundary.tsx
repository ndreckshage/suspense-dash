import { Suspense } from "react";
import { getRequestContext } from "@/lib/boundary-context";
import { metricsStore } from "@/lib/metrics-store";

interface TracedBoundaryProps {
  name: string;
  boundaryPath: string;
  render: () => Promise<React.ReactNode>;
  fallback?: React.ReactNode;
  lcpCritical?: boolean;
  route?: string;
}

/**
 * Core instrumentation wrapper for suspense boundaries.
 *
 * Wraps an async render function in <Suspense> and measures:
 * - wall_start_ms: time from request start to when this boundary begins executing
 * - render_duration_ms: time for the render function to resolve (includes fetches)
 *
 * Usage:
 *   <TracedBoundary
 *     name="nav"
 *     boundaryPath="shell.nav"
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
      />
    </Suspense>
  );
}

async function TracedBoundaryInner({
  boundaryPath,
  render,
  lcpCritical,
  route = "/products/[sku]",
}: Omit<TracedBoundaryProps, "fallback">) {
  const ctx = getRequestContext();
  const wallStart = Date.now() - ctx.requestStartTs;
  const renderStart = Date.now();

  const content = await render();

  const renderDuration = Date.now() - renderStart;

  metricsStore.recordBoundary({
    timestamp: Date.now(),
    requestId: ctx.requestId,
    route,
    boundary_path: boundaryPath,
    wall_start_ms: wallStart,
    render_duration_ms: renderDuration,
    is_lcp_critical: lcpCritical ?? false,
  });

  return <>{content}</>;
}
