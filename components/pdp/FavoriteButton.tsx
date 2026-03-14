"use client";

import { useState, useEffect } from "react";

/**
 * Client-side favorite/heart button overlaid on the hero image.
 * Simulates fetching favorite status from getUserFavorites CSR query.
 */
export function FavoriteButton() {
  const [status, setStatus] = useState<"loading" | "saved" | "unsaved">(
    "loading",
  );

  useEffect(() => {
    // Simulate favorites data arriving after getUserFavorites resolves
    const timer = setTimeout(() => {
      setStatus("unsaved");
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const isSaved = status === "saved";

  return (
    <button
      onClick={() => setStatus(isSaved ? "unsaved" : "saved")}
      disabled={status === "loading"}
      className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-zinc-900/70 backdrop-blur-sm border border-zinc-700 hover:border-zinc-500 transition-colors"
      aria-label={isSaved ? "Remove from favorites" : "Add to favorites"}
    >
      {status === "loading" ? (
        <span className="text-zinc-500 text-lg animate-pulse">&#9825;</span>
      ) : isSaved ? (
        <span className="text-red-400 text-lg">&#9829;</span>
      ) : (
        <span className="text-zinc-400 text-lg hover:text-red-400 transition-colors">
          &#9825;
        </span>
      )}
    </button>
  );
}
