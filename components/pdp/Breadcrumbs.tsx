interface BreadcrumbItem {
  name: string;
  href: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: BreadcrumbItem[] }) {
  return (
    <nav className="px-6 py-3 text-sm text-zinc-500">
      <ol className="flex items-center gap-1.5">
        {crumbs.map((crumb, i) => (
          <li key={crumb.href} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-zinc-700">/</span>}
            {i === crumbs.length - 1 ? (
              <span className="text-zinc-300">{crumb.name}</span>
            ) : (
              <a href={crumb.href} className="hover:text-zinc-300 transition-colors">
                {crumb.name}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
