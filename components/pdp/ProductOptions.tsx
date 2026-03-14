interface OptionsData {
  variants: { name: string; value: string; available: boolean }[];
}

export function ProductOptions({ data }: { data: OptionsData }) {
  return (
    <div className="px-6 md:px-0 py-4 border-t border-zinc-800">
      {/* Variants */}
      <div className="mb-4">
        <div className="text-sm text-zinc-400 mb-2">Configuration</div>
        <div className="flex gap-2">
          {data.variants.map((v) => (
            <button
              key={v.value}
              disabled={!v.available}
              className={`px-4 py-2 rounded text-sm border transition-colors ${
                v.available
                  ? "border-zinc-600 text-zinc-300 hover:border-zinc-400"
                  : "border-zinc-800 text-zinc-700 cursor-not-allowed"
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>
      </div>

      {/* Add to cart */}
      <button className="w-full md:w-auto px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition-colors">
        Add to Cart
      </button>
    </div>
  );
}
