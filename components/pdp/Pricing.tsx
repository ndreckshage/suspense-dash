interface PricingData {
  price: number;
  originalPrice: number;
  currency: string;
}

export function Pricing({ data }: { data: PricingData }) {
  const discount = Math.round(
    ((data.originalPrice - data.price) / data.originalPrice) * 100
  );

  return (
    <div className="px-6 md:px-0 py-3">
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold text-white">
          ${data.price.toFixed(2)}
        </span>
        <span className="text-sm text-zinc-500 line-through">
          ${data.originalPrice.toFixed(2)}
        </span>
        <span className="text-sm text-green-400 font-medium">
          {discount}% off
        </span>
      </div>
    </div>
  );
}
