"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";

type CsrQueryStatus = "pending" | "complete";

interface CsrQueryContextValue {
  getStatus: (queryName: string) => CsrQueryStatus;
  markComplete: (queryName: string) => void;
}

const CsrQueryContext = createContext<CsrQueryContextValue | null>(null);

export function CsrQueryProvider({ children }: { children: ReactNode }) {
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  // Hydration guard: CsrQueryRunner's effect can fire and call markComplete
  // before nested Suspense boundaries (e.g. CartIndicator in Nav) hydrate.
  // Force "pending" until after mount so the client matches server HTML.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const markComplete = useCallback((queryName: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(queryName);
      return next;
    });
  }, []);

  const getStatus = useCallback(
    (queryName: string): CsrQueryStatus =>
      hydrated && completed.has(queryName) ? "complete" : "pending",
    [completed, hydrated],
  );

  const value = useMemo(
    () => ({ getStatus, markComplete }),
    [getStatus, markComplete],
  );

  return (
    <CsrQueryContext.Provider value={value}>
      {children}
    </CsrQueryContext.Provider>
  );
}

/**
 * Subscribe to a CSR query's completion status.
 * Returns "pending" until the query simulation resolves, then "complete".
 */
export function useCsrQuery(queryName: string): CsrQueryStatus {
  const ctx = useContext(CsrQueryContext);
  if (!ctx) return "pending";
  return ctx.getStatus(queryName);
}

/**
 * Get the markComplete callback for the orchestrator to call.
 */
export function useCsrQueryContext() {
  return useContext(CsrQueryContext);
}
