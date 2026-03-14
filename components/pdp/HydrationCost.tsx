"use client";

import { useEffect, useRef } from "react";

/**
 * Simulates expensive client-side initialization work that blocks the
 * main thread during hydration. This triggers a Long Animation Frame
 * entry that shows up in the dashboard's initialization timeline.
 *
 * In a real app this could be: analytics init, A/B test SDK setup,
 * third-party script execution, large component tree hydration, etc.
 */
export function HydrationCost({ ms = 120 }: { ms?: number }) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // Synchronously block the main thread
    const start = performance.now();
    while (performance.now() - start < ms) {
      // intentionally blocking
    }
  }, [ms]);

  return null;
}
