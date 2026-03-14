"use client";

import { useState } from "react";
import { useCsrQuery } from "@/lib/csr-query-context";

/**
 * Client-side favorite/heart button overlaid on the hero image.
 * Waits for the actual getUserFavorites CSR query to resolve before showing status.
 */
export function FavoriteButton() {
  const queryStatus = useCsrQuery("getUserFavorites");
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
