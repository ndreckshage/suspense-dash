"use client";

import { useCallback } from "react";

export function SlowModeToggle({ initialSlow }: { initialSlow: boolean }) {
  const toggle = useCallback(() => {
    const url = new URL(window.location.href);
    if (initialSlow) {
      url.searchParams.delete("slow");
    } else {
      url.searchParams.set("slow", "1");
    }
    window.location.href = decodeURIComponent(url.toString());
  }, [initialSlow]);

  return (
    <button
      onClick={toggle}
      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
        initialSlow
          ? "border-amber-500 text-amber-400 bg-amber-500/10"
          : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
      }`}
    >
      {initialSlow ? "Slow" : "Slow"}
    </button>
  );
}
