"use client";

import { useState, useEffect } from "react";

/**
 * Client-side cart indicator that appears in the nav after hydration.
 * Simulates fetching cart count from getUserCart CSR query.
 */
export function CartIndicator() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    // Simulate cart data arriving after getUserCart resolves
    const timer = setTimeout(() => {
      setCount(3);
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  if (count === null) {
    return <span className="text-sm text-zinc-400">Cart (--)</span>;
  }

  return (
    <span className="text-sm text-zinc-400 relative">
      Cart
      <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold bg-blue-600 text-white rounded-full">
        {count}
      </span>
    </span>
  );
}
