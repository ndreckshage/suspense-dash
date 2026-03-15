import type { ReactNode } from "react";

interface NavData {
  categories: { name: string; href: string }[];
  logo: string;
}

export function NavBar({ data, cartSlot }: { data: NavData; cartSlot?: ReactNode }) {
  return (
    <nav className="bg-zinc-900 border-b border-zinc-800 px-4 md:px-6 py-3 md:py-4 overflow-hidden">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-lg font-bold text-white">{data.logo}</span>
          <a href="/dashboard" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">View Dash</a>
        </div>
        <div className="hidden md:flex gap-6">
          {data.categories.map((cat) => (
            <a
              key={cat.href}
              href={cat.href}
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              {cat.name}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-4 text-zinc-400 flex-shrink-0">
          <span className="text-sm">Search</span>
          {cartSlot ?? <span className="text-sm">Cart (0)</span>}
        </div>
      </div>
    </nav>
  );
}
