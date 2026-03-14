/**
 * LCP hero image — rendered inside a Suspense boundary that fetches
 * product media data (getProductMedia query).
 */
export function HeroImage({ imageUrl }: { imageUrl: string }) {
  return (
    <div className="px-6 py-6">
      <img
        src={imageUrl}
        alt="Nikon D7000 Camera"
        width={800}
        height={800}
        className="bg-zinc-800 rounded-xl aspect-square max-w-lg w-full object-cover"
        fetchPriority="high"
      />
    </div>
  );
}

/**
 * Product summary: title, description, review stars.
 * Rendered inside the pdp Suspense boundary (getProductPage query).
 */
export function ProductSummary({
  product,
}: {
  product: {
    name: string;
    shortDescription: string;
    rating: number;
    reviewCount: number;
  };
}) {
  return (
    <div className="px-6 md:px-0 pb-4">
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
  );
}
