"use client";

import { useRef, useState } from "react";
import { parseYamlDashboard } from "@/lib/yaml-import";
import type { MockDashboardData } from "@/lib/mock-metrics";

export function YamlUpload({ onLoad }: { onLoad: (data: MockDashboardData) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const data = parseYamlDashboard(text);
        onLoad(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse YAML");
      }
    };
    reader.onerror = () => setError("Failed to read file");
    reader.readAsText(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="relative">
      <button
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-400 hover:text-blue-300 hover:border-blue-800 transition-colors flex-shrink-0"
      >
        Import YAML
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".yaml,.yml"
        onChange={handleChange}
        className="hidden"
      />
      {error && (
        <div className="absolute top-full right-0 mt-1 p-2 bg-red-950 border border-red-800 rounded text-xs text-red-300 max-w-xs whitespace-pre-wrap z-50">
          {error}
        </div>
      )}
    </div>
  );
}
