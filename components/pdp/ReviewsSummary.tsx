interface ReviewSummaryData {
  average: number;
  total: number;
  distribution: number[];
}

export function ReviewsSummary({ data }: { data: ReviewSummaryData }) {
  return (
    <div className="px-6 md:px-0 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-yellow-400">
          {"★".repeat(Math.round(data.average))}
          {"☆".repeat(5 - Math.round(data.average))}
        </span>
        <span className="text-zinc-500">
          {data.average} ({data.total.toLocaleString()} reviews)
        </span>
      </div>
    </div>
  );
}
