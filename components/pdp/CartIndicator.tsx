"use client";

import { useCsrQuerySimulation } from "@/lib/csr-simulation";
import { useCsrRequestContext } from "@/components/ClientQueryOrchestrator";

/**
 * Client-side cart indicator that appears in the nav after hydration.
 * Runs its own getUserCart query simulation in useEffect.
 */
export function CartIndicator() {
  const ctx = useCsrRequestContext();
  const status = useCsrQuerySimulation(
    "getUserCart",
    "Layout.Nav.CartIndicator",
    ctx?.requestId ?? "",
    ctx?.requestStartTs ?? 0,
  );

  if (status === "pending") {
    return <span className="text-sm text-zinc-400">Cart (--)</span>;
  }

  return (
    <span className="text-sm text-zinc-400 relative">
      Cart
      <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold bg-blue-600 text-white rounded-full">
        3
      </span>
    </span>
  );
}
