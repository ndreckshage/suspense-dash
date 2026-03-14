interface NavData {
  categories: { name: string; href: string }[];
  logo: string;
}

export function NavBar({ data }: { data: NavData }) {
  return (
    <nav className="bg-zinc-900 border-b border-zinc-800 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <span className="text-lg font-bold text-white">{data.logo}</span>
        <div className="flex gap-6">
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
        <div className="flex gap-4 text-zinc-400">
          <span className="text-sm">Search</span>
          <span className="text-sm">Cart (0)</span>
        </div>
      </div>
    </nav>
  );
}
