interface ReviewsData {
  summary: {
    average: number;
    total: number;
    distribution: number[];
  };
  reviews: {
    id: string;
    author: string;
    rating: number;
    text: string;
    date: string;
    helpful: number;
  }[];
}

export function Reviews({ data }: { data: ReviewsData }) {
  return (
    <div className="px-6 py-6 border-t border-zinc-800">
      <h2 className="text-lg font-semibold text-white mb-4">
        Customer Reviews
      </h2>

      {/* Summary */}
      <div className="flex items-start gap-6 mb-6">
        <div className="text-center">
          <div className="text-4xl font-bold text-white">
            {data.summary.average}
          </div>
          <div className="text-yellow-400 text-sm">
            {"★".repeat(Math.round(data.summary.average))}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {data.summary.total.toLocaleString()} reviews
          </div>
        </div>
        <div className="flex-1 space-y-1">
          {data.summary.distribution.map((pct, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500 w-4 text-right">{5 - i}</span>
              <div className="flex-1 bg-zinc-800 rounded-full h-2">
                <div
                  className="bg-yellow-400 rounded-full h-2"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-zinc-600 w-8">{pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Individual reviews */}
      <div className="space-y-4">
        {data.reviews.map((review) => (
          <div
            key={review.id}
            className="border-t border-zinc-800/50 pt-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-yellow-400 text-xs">
                {"★".repeat(review.rating)}
                {"☆".repeat(5 - review.rating)}
              </span>
              <span className="text-sm text-zinc-400">{review.author}</span>
              <span className="text-xs text-zinc-600">
                {new Date(review.date).toLocaleDateString()}
              </span>
            </div>
            <p className="text-sm text-zinc-300">{review.text}</p>
            <div className="text-xs text-zinc-600 mt-1">
              {review.helpful} found helpful
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
