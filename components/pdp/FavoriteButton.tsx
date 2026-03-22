"use client";

import { useState } from "react";
import { useCsrQuerySimulation } from "@/lib/csr-simulation";
import { useCsrRequestContext } from "@/components/ClientQueryOrchestrator";

/**
 * Client-side favorite/heart button overlaid on the hero image.
 * Runs its own getUserFavorites query simulation in useEffect.
 */
export function FavoriteButton() {
  const ctx = useCsrRequestContext();
  const queryStatus = useCsrQuerySimulation(
    "getUserFavorites",
    "Layout.Content.Main.Hero.FavoriteButton",
    ctx?.requestId ?? "",
    ctx?.requestStartTs ?? 0,
  );
  const [toggled, setToggled] = useState(false);

  // Query resolves with "saved" state; user can toggle after
  const isSaved = queryStatus === "complete" ? !toggled : false;

  return (
    <button
      onClick={() => setToggled((prev) => !prev)}
      disabled={queryStatus === "pending"}
      className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-zinc-900/70 backdrop-blur-sm border border-zinc-700 hover:border-zinc-500 transition-colors"
      aria-label={isSaved ? "Remove from favorites" : "Add to favorites"}
    >
      {queryStatus === "pending" ? (
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
