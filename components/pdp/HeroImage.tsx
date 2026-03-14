interface ProductSummary {
  name: string;
  heroImageUrl: string;
  shortDescription: string;
  rating: number;
  reviewCount: number;
}

export function HeroImage({ product }: { product: ProductSummary }) {
  return (
    <div className="flex flex-col md:flex-row gap-8 px-6 py-6">
      {/* Placeholder hero image */}
      <div className="flex-1 bg-zinc-800 rounded-xl aspect-square max-w-lg flex items-center justify-center">
        <div className="text-center text-zinc-500">
          <div className="text-6xl mb-4">🎧</div>
          <div className="text-sm">Product Image</div>
          <div className="text-xs text-zinc-600 mt-1">{product.heroImageUrl}</div>
        </div>
      </div>
      {/* Product summary alongside hero */}
      <div className="flex-1 flex flex-col justify-center">
        <h1 className="text-3xl font-bold text-white mb-3">{product.name}</h1>
        <p className="text-zinc-400 mb-4">{product.shortDescription}</p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-yellow-400">
            {"★".repeat(Math.round(product.rating))}
            {"☆".repeat(5 - Math.round(product.rating))}
          </span>
          <span className="text-zinc-500">
            {product.rating} ({product.reviewCount.toLocaleString()} reviews)
          </span>
        </div>
      </div>
    </div>
  );
}
