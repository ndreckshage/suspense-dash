"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

interface CsrRequestContextValue {
  requestId: string;
  requestStartTs: number;
}

const CsrRequestContext = createContext<CsrRequestContextValue | null>(null);

interface Props {
  requestId: string;
  requestStartTs: number;
  children: ReactNode;
}

/**
 * Provides request context (requestId, requestStartTs) to client components
 * so they can each run their own CSR query simulation.
 */
export function ClientQueryOrchestrator({
  requestId,
  requestStartTs,
  children,
}: Props) {
  return (
    <CsrRequestContext.Provider value={{ requestId, requestStartTs }}>
      {children}
    </CsrRequestContext.Provider>
  );
}

/**
 * Hook to access the SSR request context from client components.
 */
export function useCsrRequestContext() {
  return useContext(CsrRequestContext);
}
