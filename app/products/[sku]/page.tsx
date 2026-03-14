import { TracedBoundary } from "@/components/TracedBoundary";
import { tracedFetch } from "@/lib/traced-fetch";
import { getRequestContext } from "@/lib/boundary-context";
import { metricsStore } from "@/lib/metrics-store";
import { busyWait } from "@/lib/busy-wait";
import {
  simulatedFetch,
  mockSessionConfig,
  mockNavData,
  mockFooterData,
  mockProductData,
  mockBreadcrumbs,
  mockProductDetails,
  mockCarousels,
  mockReviews,
} from "@/lib/mock-data";
import { NavBar } from "@/components/pdp/NavBar";
import { Footer } from "@/components/pdp/Footer";
import { HeroImage, ProductSummary } from "@/components/pdp/HeroImage";
import { Breadcrumbs } from "@/components/pdp/Breadcrumbs";
import { ProductDetails } from "@/components/pdp/ProductDetails";
import { Carousels } from "@/components/pdp/Carousels";
import { Reviews } from "@/components/pdp/Reviews";

/**
 * PDP page with the full instrumented boundary hierarchy.
 *
 * The shell await (session-config) and product-api fetch happen directly in the
 * async page body — NOT inside a Suspense boundary. This means the hero image
 * is part of the initial HTML payload and renders even with JS disabled.
 *
 * Only non-LCP-critical sections (nav, breadcrumbs, details, carousels, reviews,
 * footer) are wrapped in Suspense via TracedBoundary, so they stream in
 * progressively after the hero.
 *
 * Hierarchy:
 *   shell (50ms session-config)         ← direct await, no Suspense
 *   ├─ pdp (200ms product-api)          ← direct await, no Suspense, LCP critical
 *   │  └─ HeroImage                     ← in initial HTML payload
 *   ├─ nav (150ms nav-config)           ← Suspense
 *   ├─ breadcrumbs (80ms category-path) ← Suspense
 *   ├─ details (120ms pricing-api)      ← Suspense
 *   ├─ carousels (350ms reco-engine)    ← Suspense
 *   ├─ reviews (500ms reviews-service)  ← Suspense
 *   └─ footer (60ms footer-config)      ← Suspense
 */
export default async function PDPPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const ctx = getRequestContext();

  // --- Shell: blocking session-config fetch (no Suspense) ---
  const shellStart = Date.now();
  await tracedFetch(
    "session-config",
    () => simulatedFetch(50, mockSessionConfig()),
    "shell"
  );
  const shellFetchEnd = Date.now();
  const shellFetchDuration = shellFetchEnd - shellStart;

  // Simulate sync render cost for shell (layout serialization)
  busyWait(5);
  const shellSyncEnd = Date.now();
  const shellRenderCost = shellSyncEnd - shellFetchEnd;

  metricsStore.recordBoundary({
    timestamp: Date.now(),
    requestId: ctx.requestId,
    route: "/products/[sku]",
    boundary_path: "shell",
    wall_start_ms: 0,
    render_duration_ms: shellSyncEnd - shellStart,
    fetch_duration_ms: shellFetchDuration,
    render_cost_ms: shellRenderCost,
    blocked_ms: 0, // shell runs first, never blocked
    is_lcp_critical: true,
  });

  // --- Render: hero in initial HTML, everything else streams via Suspense ---
  return (
    <>
      {/* Nav — Suspense, streams after hero */}
      <TracedBoundary
        name="nav"
        boundaryPath="shell.nav"
        renderCostMs={80}
        fallback={
          <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 h-14 animate-pulse" />
        }
        render={async (ref) => {
          const data = await tracedFetch(
            "nav-config",
            () => simulatedFetch(150, mockNavData()),
            "shell.nav"
          );
          ref.ts = Date.now();
          return <NavBar data={data} />;
        }}
      />

      {/* Breadcrumbs — above the main content area */}
      <TracedBoundary
        name="breadcrumbs"
        boundaryPath="shell.pdp.breadcrumbs"
        renderCostMs={5}
        fallback={
          <div className="max-w-7xl mx-auto px-6 py-3">
            <div className="h-4 bg-zinc-800 rounded w-64 animate-pulse" />
          </div>
        }
        render={async (ref) => {
          const crumbs = await tracedFetch(
            "category-path",
            () => simulatedFetch(80, mockBreadcrumbs()),
            "shell.pdp.breadcrumbs"
          );
          ref.ts = Date.now();
          return (
            <div className="max-w-7xl mx-auto">
              <Breadcrumbs crumbs={crumbs} />
            </div>
          );
        }}
      />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto">
          {/* Two-column PDP layout: hero left, product info right */}
          <div className="flex flex-col md:flex-row md:items-start">
            {/* Left: Hero image — in initial HTML, no Suspense, works without JS */}
            <div className="md:w-1/2 flex-shrink-0">
              <HeroImage />
            </div>

            {/* Right: title, details, ATC — all behind Suspense */}
            <div className="md:w-1/2 md:py-6 md:pl-6">
              {/* Product title + rating */}
              <TracedBoundary
                name="pdp"
                boundaryPath="shell.pdp"
                lcpCritical={true}
                renderCostMs={5}
                fallback={
                  <div className="px-6 md:px-0 pb-4 space-y-3">
                    <div className="h-8 bg-zinc-800 rounded w-3/4 animate-pulse" />
                    <div className="h-4 bg-zinc-800 rounded w-full animate-pulse" />
                    <div className="h-4 bg-zinc-800 rounded w-1/3 animate-pulse" />
                  </div>
                }
                render={async (ref) => {
                  const product = await tracedFetch(
                    "product-api",
                    () => simulatedFetch(200, mockProductData(sku)),
                    "shell.pdp"
                  );
                  ref.ts = Date.now();
                  return <ProductSummary product={product} />;
                }}
              />

              {/* Product Details: pricing, variants, ATC */}
              <TracedBoundary
                name="details"
                boundaryPath="shell.pdp.details"
                renderCostMs={10}
                fallback={
                  <div className="px-6 md:px-0 py-4 border-t border-zinc-800 space-y-3">
                    <div className="h-8 bg-zinc-800 rounded w-32 animate-pulse" />
                    <div className="h-10 bg-zinc-800 rounded w-48 animate-pulse" />
                  </div>
                }
                render={async (ref) => {
                  const details = await tracedFetch(
                    "pricing-api",
                    () => simulatedFetch(120, mockProductDetails()),
                    "shell.pdp.details"
                  );
                  ref.ts = Date.now();
                  return <ProductDetails details={details} />;
                }}
              />
            </div>
          </div>

          {/* Below the fold: carousels + reviews */}

          {/* Carousels */}
          <TracedBoundary
            name="carousels"
            boundaryPath="shell.pdp.carousels"
            renderCostMs={15}
            fallback={
              <div className="px-6 py-6 border-t border-zinc-800">
                <div className="h-5 bg-zinc-800 rounded w-48 animate-pulse mb-4" />
                <div className="flex gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-44 h-52 bg-zinc-800 rounded-lg animate-pulse flex-shrink-0"
                    />
                  ))}
                </div>
              </div>
            }
            render={async (ref) => {
              const data = await tracedFetch(
                "reco-engine",
                () => simulatedFetch(350, mockCarousels()),
                "shell.pdp.carousels"
              );
              ref.ts = Date.now();
              return <Carousels data={data} />;
            }}
          />

          {/* Reviews — slowest boundary */}
          <TracedBoundary
            name="reviews"
            boundaryPath="shell.pdp.reviews"
            renderCostMs={5}
            fallback={
              <div className="px-6 py-6 border-t border-zinc-800">
                <div className="h-5 bg-zinc-800 rounded w-40 animate-pulse mb-4" />
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-16 bg-zinc-800 rounded animate-pulse"
                    />
                  ))}
                </div>
              </div>
            }
            render={async (ref) => {
              const data = await tracedFetch(
                "reviews-service",
                () => simulatedFetch(500, mockReviews()),
                "shell.pdp.reviews"
              );
              ref.ts = Date.now();
              return <Reviews data={data} />;
            }}
          />
        </div>
      </main>

      {/* Footer */}
      <TracedBoundary
        name="footer"
        boundaryPath="shell.footer"
        renderCostMs={5}
        fallback={
          <div className="bg-zinc-900 border-t border-zinc-800 h-48 animate-pulse" />
        }
        render={async (ref) => {
          const data = await tracedFetch(
            "footer-config",
            () => simulatedFetch(60, mockFooterData()),
            "shell.footer"
          );
          ref.ts = Date.now();
          return <Footer data={data} />;
        }}
      />
    </>
  );
}
