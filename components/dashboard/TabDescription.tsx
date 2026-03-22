"use client";

import { useState } from "react";

interface Props {
  title: string;
  children: React.ReactNode;
}

/**
 * Collapsible description block for dashboard tabs.
 * Starts expanded so first-time viewers see context, then can be collapsed.
 */
export function TabDescription({ title, children }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 text-xs text-zinc-400 mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
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
