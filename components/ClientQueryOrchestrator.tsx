"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { simulateCsrQueries } from "@/lib/csr-simulation";
import { clientMetricsStore } from "@/lib/client-metrics-store";
import { CsrQueryProvider, useCsrQueryContext } from "@/lib/csr-query-context";

interface Props {
  requestId: string;
  requestStartTs: number;
  children: ReactNode;
}

/**
 * Wraps children in CsrQueryProvider and runs the CSR query simulation.
 * UI components inside use useCsrQuery() to know when their query resolves.
 */
export function ClientQueryOrchestrator({
  requestId,
  requestStartTs,
  children,
}: Props) {
  return (
    <CsrQueryProvider>
      <CsrQueryRunner
        requestId={requestId}
        requestStartTs={requestStartTs}
      />
      {children}
    </CsrQueryProvider>
  );
}

function CsrQueryRunner({
  requestId,
  requestStartTs,
}: {
  requestId: string;
  requestStartTs: number;
}) {
  const ctx = useCsrQueryContext();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const hydrationMs = Date.now() - requestStartTs;

    simulateCsrQueries(
      requestId,
      requestStartTs,
      hydrationMs,
      (queryName) => ctx?.markComplete(queryName),
    ).then((result) => {
      clientMetricsStore.appendCsrMetrics(requestId, result);
    });
  }, [requestId, requestStartTs, ctx]);

  return null;
}
