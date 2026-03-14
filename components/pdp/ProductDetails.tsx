interface DetailsData {
  price: number;
  originalPrice: number;
  currency: string;
  inStock: boolean;
  variants: { name: string; value: string; available: boolean }[];
  specs: { label: string; value: string }[];
}

export function ProductDetails({ details }: { details: DetailsData }) {
  const discount = Math.round(
    ((details.originalPrice - details.price) / details.originalPrice) * 100
  );

  return (
    <div className="px-6 py-4 border-t border-zinc-800">
      {/* Pricing */}
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-2xl font-bold text-white">
          ${details.price.toFixed(2)}
        </span>
        <span className="text-sm text-zinc-500 line-through">
          ${details.originalPrice.toFixed(2)}
        </span>
        <span className="text-sm text-green-400 font-medium">
          {discount}% off
        </span>
      </div>

      {/* Stock status */}
      <div className="mb-4">
        {details.inStock ? (
          <span className="text-sm text-green-400">In Stock</span>
        ) : (
          <span className="text-sm text-red-400">Out of Stock</span>
        )}
      </div>

      {/* Variants */}
      <div className="mb-6">
        <div className="text-sm text-zinc-400 mb-2">Color</div>
        <div className="flex gap-2">
          {details.variants.map((v) => (
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

      {/* Specs */}
      <div className="mt-6 grid grid-cols-2 gap-2">
        {details.specs.map((spec) => (
          <div key={spec.label} className="text-sm">
            <span className="text-zinc-500">{spec.label}: </span>
            <span className="text-zinc-300">{spec.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
