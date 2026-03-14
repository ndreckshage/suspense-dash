"use client";

import { useCsrQuerySimulation } from "@/lib/csr-simulation";
import { useCsrRequestContext } from "@/components/ClientQueryOrchestrator";

interface QAItem {
  question: string;
  answer: string;
  votes: number;
}

const MOCK_QA: QAItem[] = [
  {
    question: "Is this compatible with older lenses?",
    answer:
      "Yes, it supports all Nikon F-mount lenses including older AF and AI/AI-S models.",
    votes: 24,
  },
  {
    question: "What's the maximum video resolution?",
    answer:
      "It records 1080p Full HD at 24fps. No 4K on this model.",
    votes: 18,
  },
  {
    question: "Does it have built-in Wi-Fi?",
    answer:
      "No built-in Wi-Fi, but you can use a WU-1a wireless adapter (sold separately).",
    votes: 12,
  },
];

/**
 * Client-side Q&A section loaded after hydration via getReviewsQA CSR query.
 * Runs its own query simulation with a 200ms stagger delay.
 */
export function ReviewsQA() {
  const ctx = useCsrRequestContext();
  const status = useCsrQuerySimulation(
    "getReviewsQA",
    "csr.ReviewsQA",
    ctx?.requestId ?? "",
    ctx?.requestStartTs ?? 0,
    200, // stagger delay
  );

  return (
    <div className="px-6 py-6 border-t border-zinc-800">
      <h2 className="text-lg font-semibold text-white mb-4">
        Questions & Answers
      </h2>

      {status === "pending" ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 bg-zinc-800 rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-zinc-800 rounded w-full animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {MOCK_QA.map((item, i) => (
            <div key={i} className="border-t border-zinc-800/50 pt-3 first:border-0 first:pt-0">
              <div className="flex gap-2 mb-1">
                <span className="text-blue-400 font-bold text-sm flex-shrink-0">Q:</span>
                <span className="text-sm text-zinc-200">{item.question}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-green-400 font-bold text-sm flex-shrink-0">A:</span>
                <span className="text-sm text-zinc-400">{item.answer}</span>
              </div>
              <div className="text-xs text-zinc-600 mt-1 pl-5">
                {item.votes} found helpful
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
