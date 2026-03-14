interface BulletsData {
  bullets: string[];
  specs: { label: string; value: string }[];
}

export function ProductBullets({ data }: { data: BulletsData }) {
  return (
    <div className="px-6 md:px-0 py-4 border-t border-zinc-800">
      {/* Key features */}
      <ul className="space-y-1.5 mb-4">
        {data.bullets.map((bullet, i) => (
          <li key={i} className="text-sm text-zinc-400 flex items-start gap-2">
            <span className="text-zinc-600 mt-0.5">-</span>
            {bullet}
          </li>
        ))}
      </ul>

      {/* Specs */}
      <div className="grid grid-cols-2 gap-2">
        {data.specs.map((spec) => (
          <div key={spec.label} className="text-sm">
            <span className="text-zinc-500">{spec.label}: </span>
            <span className="text-zinc-300">{spec.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
