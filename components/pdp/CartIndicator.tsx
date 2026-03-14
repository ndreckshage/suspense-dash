"use client";

import { useCsrQuery } from "@/lib/csr-query-context";

/**
 * Client-side cart indicator that appears in the nav after hydration.
 * Waits for the actual getUserCart CSR query to resolve before showing count.
 */
export function CartIndicator() {
  const status = useCsrQuery("getUserCart");

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
