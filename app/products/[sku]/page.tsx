import { TracedBoundary } from "@/components/TracedBoundary";
import { executeGqlQuery } from "@/lib/gql-query";
import { getRequestContext } from "@/lib/boundary-context";
import { metricsStore } from "@/lib/metrics-store";
import { busyWait } from "@/lib/busy-wait";
import {
  mockExperimentContext,
  mockNavData,
  mockContentLayout,
  mockBreadcrumbs,
  mockHeroImage,
  mockThumbnails,
  mockProductInfo,
  mockProductPricing,
  mockCarousels,
  mockReviews,
  mockFooterData,
} from "@/lib/mock-data";
import { NavBar } from "@/components/pdp/NavBar";
import { Footer } from "@/components/pdp/Footer";
import { HeroImage, ProductSummary } from "@/components/pdp/HeroImage";
import { Thumbnails } from "@/components/pdp/Thumbnails";
import { Breadcrumbs } from "@/components/pdp/Breadcrumbs";
import { Pricing } from "@/components/pdp/Pricing";
import { Inventory } from "@/components/pdp/Inventory";
import { ProductBullets } from "@/components/pdp/ProductBullets";
import { ProductOptions } from "@/components/pdp/ProductOptions";
import { Carousels } from "@/components/pdp/Carousels";
import { Reviews } from "@/components/pdp/Reviews";

/**
 * PDP page with GQL Federation simulation.
 *
 * Hierarchy:
 *   shell (await: getExperimentContext — blocks all content)
 *   ├─ nav (getNavigation → cms.navigation)
 *   ├─ content (getContentLayout → cms.layout)
 *   │  └─ breadcrumbs (getBreadcrumbs → category.tree)
 *   ├─ main
 *   │  ├─ left
 *   │  │  ├─ hero (getHeroImage → media.heroImage) [blocking — no Suspense, for JS-disabled]
 *   │  │  └─ thumbnails (getThumbnails → media.thumbnails)
 *   │  └─ right
 *   │     ├─ pdp (getProductInfo → product.core + product.bullets,
 *   │     │      getProductPricing → pricing.current + inventory + reviews.summary) [LCP]
 *   │     ├─ bullets (getProductInfo → cache hit!)
 *   │     └─ options (variants + add to cart, from getProductInfo cache hit)
 *   ├─ carousels (getRecommendations → reco.personalized, product.cards, pricing.batch)
 *   ├─ reviews (getReviews → reviews.list)
 *   └─ footer (getFooter → cms.footer)
 *
 * Key patterns:
 * - Sequential waterfall: experiment context blocks all downstream content
 * - Query grouping: getProductPricing bundles pricing + inventory + reviews.summary
 * - Cache dedup: getProductInfo called by pdp + bullets + options — second/third are instant
 */
export default async function PDPPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const ctx = getRequestContext();

  // --- Shell: blocking experiment context (sequential waterfall) ---
  const shellStart = Date.now();
  await executeGqlQuery("getExperimentContext", "shell", mockExperimentContext);
  const shellFetchEnd = Date.now();
  const shellFetchDuration = shellFetchEnd - shellStart;

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
    blocked_ms: 0,
    is_lcp_critical: true,
  });

  // --- Hero image: fetched at page level so <img> is in initial HTML (works without JS) ---
  const heroStart = Date.now();
  const heroWallStart = heroStart - ctx.requestStartTs;
  const heroData = await executeGqlQuery(
    "getHeroImage",
    "shell.content.main.hero",
    mockHeroImage,
  );
  const heroFetchEnd = Date.now();
  const heroFetchDuration = heroFetchEnd - heroStart;
  busyWait(3);
  const heroSyncEnd = Date.now();
  const heroRenderCost = heroSyncEnd - heroFetchEnd;

  metricsStore.recordBoundary({
    timestamp: Date.now(),
    requestId: ctx.requestId,
    route: "/products/[sku]",
    boundary_path: "shell.content.main.hero",
    wall_start_ms: heroWallStart,
    render_duration_ms: heroSyncEnd - heroStart,
    fetch_duration_ms: heroFetchDuration,
    render_cost_ms: heroRenderCost,
    blocked_ms: 0,
    is_lcp_critical: true,
  });

  return (
    <>
      {/* Nav */}
      <TracedBoundary
        name="nav"
        boundaryPath="shell.nav"
        renderCostMs={80}
        fallback={
          <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 h-14 animate-pulse" />
        }
        render={async (ref) => {
          const data = await executeGqlQuery(
            "getNavigation",
            "shell.nav",
            mockNavData,
          );
          ref.ts = Date.now();
          return <NavBar data={data} />;
        }}
      />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto">
          {/* Content wrapper — fetches CMS layout, gates breadcrumbs */}
          <TracedBoundary
            name="content"
            boundaryPath="shell.content"
            renderCostMs={2}
            fallback={
              <div className="px-6 py-3">
                <div className="h-4 bg-zinc-800 rounded w-64 animate-pulse" />
              </div>
            }
            render={async (ref) => {
              await executeGqlQuery(
                "getContentLayout",
                "shell.content",
                mockContentLayout,
              );
              ref.ts = Date.now();
              return (
                <TracedBoundary
                  name="breadcrumbs"
                  boundaryPath="shell.content.breadcrumbs"
                  renderCostMs={5}
                  fallback={
                    <div className="px-6 py-3">
                      <div className="h-4 bg-zinc-800 rounded w-64 animate-pulse" />
                    </div>
                  }
                  render={async (ref) => {
                    const crumbs = await executeGqlQuery(
                      "getBreadcrumbs",
                      "shell.content.breadcrumbs",
                      mockBreadcrumbs,
                    );
                    ref.ts = Date.now();
                    return <Breadcrumbs crumbs={crumbs} />;
                  }}
                />
              );
            }}
          />

          {/* Two-column PDP layout */}
          <div className="flex flex-col md:flex-row md:items-start">
            {/* Left: hero image (outside Suspense for JS-disabled) + thumbnails */}
            <div className="md:w-1/2 flex-shrink-0">
              <HeroImage imageUrl={heroData.heroImage} />

              {/* Thumbnails — own query, own boundary */}
              <TracedBoundary
                name="thumbnails"
                boundaryPath="shell.content.main.thumbnails"
                renderCostMs={3}
                fallback={
                  <div className="px-6 py-2 flex gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-16 h-16 bg-zinc-800 rounded-lg animate-pulse"
                      />
                    ))}
                  </div>
                }
                render={async (ref) => {
                  const data = await executeGqlQuery(
                    "getThumbnails",
                    "shell.content.main.thumbnails",
                    mockThumbnails,
                  );
                  ref.ts = Date.now();
                  return <Thumbnails thumbnails={data.thumbnails} />;
                }}
              />
            </div>

            {/* Right: product info */}
            <div className="md:w-1/2 md:py-6 md:pl-6">
              {/* PDP — getProductInfo (product.core + bullets) + getProductPricing */}
              <TracedBoundary
                name="pdp"
                boundaryPath="shell.content.main.pdp"
                lcpCritical={true}
                renderCostMs={5}
                fallback={
                  <div className="px-6 md:px-0 pb-4 space-y-3">
                    {/* Title */}
                    <div className="h-9 bg-zinc-800 rounded w-3/4 animate-pulse" />
                    {/* Description */}
                    <div className="h-4 bg-zinc-800 rounded w-full animate-pulse" />
                    <div className="h-4 bg-zinc-800 rounded w-2/3 animate-pulse" />
                    {/* Rating */}
                    <div className="h-4 bg-zinc-800 rounded w-48 animate-pulse" />
                    {/* Price */}
                    <div className="h-10 bg-zinc-800 rounded w-40 animate-pulse mt-4" />
                    {/* Original price + discount */}
                    <div className="h-4 bg-zinc-800 rounded w-32 animate-pulse" />
                    {/* Inventory */}
                    <div className="h-4 bg-zinc-800 rounded w-36 animate-pulse mt-2" />
                  </div>
                }
                render={async (ref) => {
                  const [info, pricing] = await Promise.all([
                    executeGqlQuery(
                      "getProductInfo",
                      "shell.content.main.pdp",
                      () => mockProductInfo(sku),
                    ),
                    executeGqlQuery(
                      "getProductPricing",
                      "shell.content.main.pdp",
                      mockProductPricing,
                    ),
                  ]);
                  ref.ts = Date.now();
                  return (
                    <>
                      <ProductSummary product={info} />
                      <Pricing
                        data={{
                          price: pricing.price,
                          originalPrice: pricing.originalPrice,
                          currency: pricing.currency,
                        }}
                      />
                      <Inventory data={pricing.inventory} />
                    </>
                  );
                }}
              />

              {/* Bullets — getProductInfo cache hit → key features + specs */}
              <TracedBoundary
                name="bullets"
                boundaryPath="shell.content.main.bullets"
                renderCostMs={3}
                fallback={
                  <div className="px-6 md:px-0 py-4 border-t border-zinc-800 space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-4 bg-zinc-800 rounded w-full animate-pulse" />
                    ))}
                  </div>
                }
                render={async (ref) => {
                  const info = await executeGqlQuery(
                    "getProductInfo",
                    "shell.content.main.bullets",
                    () => mockProductInfo(sku),
                  );
                  ref.ts = Date.now();
                  return <ProductBullets data={info} />;
                }}
              />

              {/* Options — getProductInfo cache hit → variants + add to cart */}
              <TracedBoundary
                name="options"
                boundaryPath="shell.content.main.options"
                renderCostMs={3}
                fallback={
                  <div className="px-6 md:px-0 py-4 border-t border-zinc-800 space-y-3">
                    <div className="h-10 bg-zinc-800 rounded w-48 animate-pulse" />
                    <div className="h-12 bg-zinc-800 rounded w-full animate-pulse" />
                  </div>
                }
                render={async (ref) => {
                  const info = await executeGqlQuery(
                    "getProductInfo",
                    "shell.content.main.options",
                    () => mockProductInfo(sku),
                  );
                  ref.ts = Date.now();
                  return <ProductOptions data={info} />;
                }}
              />
            </div>
          </div>

          {/* Carousels — grouped: reco + product cards + pricing batch */}
          <TracedBoundary
            name="carousels"
            boundaryPath="shell.content.carousels"
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
              const data = await executeGqlQuery(
                "getRecommendations",
                "shell.content.carousels",
                mockCarousels,
              );
              ref.ts = Date.now();
              return <Carousels data={data} />;
            }}
          />

          {/* Reviews — reviews.list subgraph (slowest) */}
          <TracedBoundary
            name="reviews"
            boundaryPath="shell.content.reviews"
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
              const data = await executeGqlQuery(
                "getReviews",
                "shell.content.reviews",
                mockReviews,
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
          const data = await executeGqlQuery(
            "getFooter",
            "shell.footer",
            mockFooterData,
          );
          ref.ts = Date.now();
          return <Footer data={data} />;
        }}
      />
    </>
  );
}
