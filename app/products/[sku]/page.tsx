import { TracedBoundary } from "@/components/TracedBoundary";
import { tracedFetch } from "@/lib/traced-fetch";
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
import { HeroImage } from "@/components/pdp/HeroImage";
import { Breadcrumbs } from "@/components/pdp/Breadcrumbs";
import { ProductDetails } from "@/components/pdp/ProductDetails";
import { Carousels } from "@/components/pdp/Carousels";
import { Reviews } from "@/components/pdp/Reviews";

/**
 * PDP page with the full instrumented boundary hierarchy.
 *
 * The shell boundary wraps everything and has a blocking 50ms "session config"
 * await. This demonstrates the parent-blocks-children problem: all downstream
 * boundaries (nav, pdp, footer) are delayed by the shell await.
 *
 * NOTE: All boundaries live in the page (not the layout) because Next.js App
 * Router renders layouts and pages concurrently. A blocking await in the layout
 * does NOT delay the page. To correctly demonstrate parent-blocks-children,
 * the entire hierarchy must be in a single rendering tree.
 *
 * Hierarchy:
 *   shell (50ms session-config)
 *   ├─ nav (150ms nav-config)
 *   ├─ pdp (200ms product-api) ← LCP critical
 *   │  ├─ HeroImage (no own boundary, streams with pdp)
 *   │  ├─ breadcrumbs (80ms category-path)
 *   │  ├─ details (120ms pricing-api)
 *   │  ├─ carousels (350ms reco-engine)
 *   │  └─ reviews (500ms reviews-service)
 *   └─ footer (60ms footer-config)
 */
export default async function PDPPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;

  return (
    <TracedBoundary
      name="shell"
      boundaryPath="shell"
      lcpCritical={true}
      fallback={<div className="min-h-screen bg-zinc-950 animate-pulse" />}
      render={async () => {
        // Shell-level blocking fetch: simulated session validation / feature flags
        // This ~50ms await blocks EVERYTHING downstream including the hero image
        await tracedFetch(
          "session-config",
          () => simulatedFetch(50, mockSessionConfig()),
          "shell"
        );

        return (
          <>
            {/* Nav — own suspense boundary */}
            <TracedBoundary
              name="nav"
              boundaryPath="shell.nav"
              fallback={
                <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 h-14 animate-pulse" />
              }
              render={async () => {
                const data = await tracedFetch(
                  "nav-config",
                  () => simulatedFetch(150, mockNavData()),
                  "shell.nav"
                );
                return <NavBar data={data} />;
              }}
            />

            {/* PDP Content — LCP critical boundary */}
            <main className="min-h-screen">
              <TracedBoundary
                name="pdp"
                boundaryPath="shell.pdp"
                lcpCritical={true}
                fallback={
                  <div className="max-w-7xl mx-auto p-6 space-y-6">
                    <div className="h-4 bg-zinc-800 rounded w-48 animate-pulse" />
                    <div className="flex gap-8">
                      <div className="flex-1 aspect-square bg-zinc-800 rounded-xl animate-pulse max-w-lg" />
                      <div className="flex-1 space-y-4">
                        <div className="h-8 bg-zinc-800 rounded w-3/4 animate-pulse" />
                        <div className="h-4 bg-zinc-800 rounded w-full animate-pulse" />
                        <div className="h-4 bg-zinc-800 rounded w-2/3 animate-pulse" />
                      </div>
                    </div>
                  </div>
                }
                render={async () => {
                  // Product API fetch — provides hero image URL
                  // This fetch is at the PDP Content boundary level,
                  // so the hero image data streams as part of the PDP Content shell
                  const product = await tracedFetch(
                    "product-api",
                    () => simulatedFetch(200, mockProductData(sku)),
                    "shell.pdp"
                  );

                  return (
                    <div className="max-w-7xl mx-auto">
                      {/* Hero image rendered directly — NOT in its own suspense boundary.
                          Available as soon as PDP Content boundary resolves. */}
                      <HeroImage product={product} />

                      {/* Breadcrumbs */}
                      <TracedBoundary
                        name="breadcrumbs"
                        boundaryPath="shell.pdp.breadcrumbs"
                        fallback={
                          <div className="px-6 py-3">
                            <div className="h-4 bg-zinc-800 rounded w-64 animate-pulse" />
                          </div>
                        }
                        render={async () => {
                          const crumbs = await tracedFetch(
                            "category-path",
                            () => simulatedFetch(80, mockBreadcrumbs()),
                            "shell.pdp.breadcrumbs"
                          );
                          return <Breadcrumbs crumbs={crumbs} />;
                        }}
                      />

                      {/* Product Details */}
                      <TracedBoundary
                        name="details"
                        boundaryPath="shell.pdp.details"
                        fallback={
                          <div className="px-6 py-4 border-t border-zinc-800 space-y-3">
                            <div className="h-8 bg-zinc-800 rounded w-32 animate-pulse" />
                            <div className="h-10 bg-zinc-800 rounded w-48 animate-pulse" />
                          </div>
                        }
                        render={async () => {
                          const details = await tracedFetch(
                            "pricing-api",
                            () => simulatedFetch(120, mockProductDetails()),
                            "shell.pdp.details"
                          );
                          return <ProductDetails details={details} />;
                        }}
                      />

                      {/* Carousels */}
                      <TracedBoundary
                        name="carousels"
                        boundaryPath="shell.pdp.carousels"
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
                        render={async () => {
                          const data = await tracedFetch(
                            "reco-engine",
                            () => simulatedFetch(350, mockCarousels()),
                            "shell.pdp.carousels"
                          );
                          return <Carousels data={data} />;
                        }}
                      />

                      {/* Reviews — slowest boundary */}
                      <TracedBoundary
                        name="reviews"
                        boundaryPath="shell.pdp.reviews"
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
                        render={async () => {
                          const data = await tracedFetch(
                            "reviews-service",
                            () => simulatedFetch(500, mockReviews()),
                            "shell.pdp.reviews"
                          );
                          return <Reviews data={data} />;
                        }}
                      />
                    </div>
                  );
                }}
              />
            </main>

            {/* Footer */}
            <TracedBoundary
              name="footer"
              boundaryPath="shell.footer"
              fallback={
                <div className="bg-zinc-900 border-t border-zinc-800 h-48 animate-pulse" />
              }
              render={async () => {
                const data = await tracedFetch(
                  "footer-config",
                  () => simulatedFetch(60, mockFooterData()),
                  "shell.footer"
                );
                return <Footer data={data} />;
              }}
            />
          </>
        );
      }}
    />
  );
}
