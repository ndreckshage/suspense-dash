interface FooterData {
  columns: {
    title: string;
    links: string[];
  }[];
  copyright: string;
}

export function Footer({ data }: { data: FooterData }) {
  return (
    <footer className="bg-zinc-900 border-t border-zinc-800 px-4 md:px-6 py-8 mt-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 mb-6">
          {data.columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">
                {col.title}
              </h3>
              <ul className="space-y-1.5">
                {col.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="text-xs text-zinc-600 border-t border-zinc-800 pt-4">
          {data.copyright}
        </div>
      </div>
    </footer>
  );
}
