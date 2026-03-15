import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-2xl font-bold text-white">Suspense Dash</h1>
        <p className="text-zinc-400 max-w-md">
          Visualize React Suspense boundaries, streaming SSR waterfalls, and
          per-component render/fetch metrics.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/products/demo-sku"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition-colors"
          >
            View Demo
          </Link>
          <Link
            href="/dashboard"
            className="px-6 py-3 border border-zinc-700 text-zinc-300 rounded-lg font-medium hover:border-zinc-500 transition-colors"
          >
            View Dash
          </Link>
        </div>
      </div>
    </div>
  );
}
