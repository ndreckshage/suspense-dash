"use client";

import { useState, useEffect, useCallback } from "react";

interface Props {
  title: string;
  /** Unique key for persisting collapsed state in localStorage */
  storageKey: string;
  children: React.ReactNode;
}

const STORAGE_PREFIX = "tab-desc-";

/**
 * Collapsible description block for dashboard tabs.
 * Starts expanded on first visit, then remembers the user's preference.
 */
export function TabDescription({ title, storageKey, children }: Props) {
  const fullKey = STORAGE_PREFIX + storageKey;

  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(fullKey);
    return stored === null ? true : stored === "1";
  });

  // Sync to localStorage on toggle
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(fullKey, next ? "1" : "0");
      } catch {
        // localStorage full or unavailable — ignore
      }
      return next;
    });
  }, [fullKey]);

  // Hydration safety: re-read on mount in case SSR defaulted to true
  useEffect(() => {
    const stored = localStorage.getItem(fullKey);
    if (stored !== null) setOpen(stored === "1");
  }, [fullKey]);

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 text-xs text-zinc-400 mb-4">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:text-zinc-300 transition-colors"
      >
        <span className="text-zinc-500">{open ? "▾" : "▸"}</span>
        <span className="font-medium text-zinc-300">{title}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
