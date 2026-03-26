"use client";

import { useState, useCallback, type ReactNode } from "react";

export function Tooltip({ content, children, className, style }: { content: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const onEnter = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
    setShow(true);
  }, []);

  const onMove = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  const onLeave = useCallback(() => setShow(false), []);

  return (
    <div
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={className ?? "relative"}
      style={style}
    >
      {children}
      {show && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: Math.min(pos.x + 12, (typeof window !== "undefined" ? window.innerWidth : 9999) - 340), top: pos.y - 8 }}
        >
          <div className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 shadow-xl text-xs font-mono text-zinc-200 max-w-xs break-words overflow-hidden">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

export interface TooltipLine {
  label: string;
  value: string | number;
  color?: string;
}

export function TooltipContent({ title, lines, tag }: { title: string; lines: TooltipLine[]; tag?: string }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-zinc-100 font-medium">{title}</span>
        {tag && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">{tag}</span>}
      </div>
      {lines.map((line, i) => (
        <div key={i} className="flex justify-between gap-4 min-w-0">
          <span className="text-zinc-500 flex-shrink-0">{line.label}</span>
          <span className={`truncate ${line.color ?? "text-zinc-200"}`}>{line.value}</span>
        </div>
      ))}
    </>
  );
}
