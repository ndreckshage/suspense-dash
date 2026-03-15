import { TracedBoundary } from "@/components/TracedBoundary";
import { MetricsEmbed } from "@/components/MetricsEmbed";
import { ClientQueryOrchestrator } from "@/components/ClientQueryOrchestrator";
import { HydrationCost } from "@/components/pdp/HydrationCost";
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
import { CartIndicator } from "@/components/pdp/CartIndicator";
import { FavoriteButton } from "@/components/pdp/FavoriteButton";
import { ReviewsQA } from "@/components/pdp/ReviewsQA";
import { Footer } from "@/components/pdp/Footer";
import { HeroImage, ProductSummary } from "@/components/pdp/HeroImage";
import { Thumbnails } from "@/components/pdp/Thumbnails";
import { Breadcrumbs } from "@/components/pdp/Breadcrumbs";
import { Pricing } from "@/components/pdp/Pricing";
import { Inventory } from "@/components/pdp/Inventory";
import { ProductBullets } from "@/components/pdp/ProductBullets";
import { ProductOptions } from "@/components/pdp/ProductOptions";
import { AddToCart } from "@/components/pdp/AddToCart";
import { Carousels } from "@/components/pdp/Carousels";
import { Reviews } from "@/components/pdp/Reviews";

/**
 * PDP page with GQL Federation simulation.
 *
 * Hierarchy:
 *   Layout (await: getExperimentContext — blocks all content)
 *   ├─ Nav (getNavigation → cms.navigation)
 *   ├─ Content (getContentLayout → cms.layout)
 *   │  └─ Breadcrumbs (getBreadcrumbs → category.tree)
 *   ├─ Main
 *   │  ├─ left
 *   │  │  ├─ Hero (getHeroImage → media.heroImage) [blocking — no Suspense, for JS-disabled]
 *   │  │  └─ Thumbnails (getThumbnails → media.thumbnails)
 *   │  └─ right
 *   │     ├─ Title (getProductInfo → product.core + product.bullets) [LCP]
 *   │     ├─ Pricing (getProductPricing → pricing.current + inventory + reviews.summary)
 *   │     ├─ Bullets (getProductInfo → cache hit!)
 *   │     ├─ Options (variants, from getProductInfo cache hit)
 *   │     └─ AddToCart (static — no query)
 *   ├─ Carousels (getRecommendations → reco.personalized, product.cards, pricing.batch)
 *   ├─ Reviews (getReviews → reviews.list)
 *   └─ Footer (getFooter → cms.footer)
 *
 * Key patterns:
 * - Sequential waterfall: experiment context blocks all downstream content
 * - Query grouping: getProductPricing bundles pricing + inventory + reviews.summary
 * - Cache dedup: getProductInfo called by Title + Bullets + Options — second/third are instant
 */
export default async function PDPPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ slow?: string }>;
}) {
  const { sku } = await params;
  const query = await searchParams;
  const ctx = getRequestContext();
  if (query.slow === "1") {
    ctx.slowMode = true;
  }

  // --- Layout: blocking experiment context (sequential waterfall) ---
  const layoutStart = Date.now();
  await executeGqlQuery(
    "getExperimentContext",
    "Layout",
    mockExperimentContext,
  );
  const layoutFetchEnd = Date.now();
  const layoutFetchDuration = layoutFetchEnd - layoutStart;

  busyWait(5);
  const layoutSyncEnd = Date.now();
  const layoutRenderCost = layoutSyncEnd - layoutFetchEnd;

  metricsStore.recordBoundary({
    timestamp: Date.now(),
    requestId: ctx.requestId,
    route: "/products/[sku]",
    boundary_path: "Layout",
    wall_start_ms: 0,
    render_duration_ms: layoutSyncEnd - layoutStart,
    fetch_duration_ms: layoutFetchDuration,
    render_cost_ms: layoutRenderCost,
    blocked_ms: 0,
    is_lcp_critical: true,
  });

  // --- Hero image: fetched at page level so <img> is in initial HTML (works without JS) ---
  const heroStart = Date.now();
  const heroWallStart = heroStart - ctx.requestStartTs;
  const heroData = await executeGqlQuery(
    "getHeroImage",
    "Layout.Content.Main.Hero",
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
    boundary_path: "Layout.Content.Main.Hero",
    wall_start_ms: heroWallStart,
    render_duration_ms: heroSyncEnd - heroStart,
    fetch_duration_ms: heroFetchDuration,
    render_cost_ms: heroRenderCost,
    blocked_ms: 0,
    is_lcp_critical: true,
  });

  return (
    <ClientQueryOrchestrator
      requestId={ctx.requestId}
      requestStartTs={ctx.requestStartTs}
    >
      {/* Simulates expensive client-side init (analytics, A/B SDK, etc.) */}
      <HydrationCost ms={120} />

      {/* Nav */}
      <TracedBoundary
        name="Nav"
        boundaryPath="Layout.Nav"
        renderCostMs={80}
        fallback={
          <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 md:h-[61px] h-[53px] animate-pulse" />
        }
        render={async (ref) => {
          const data = await executeGqlQuery(
            "getNavigation",
            "Layout.Nav",
            mockNavData,
          );
          ref.ts = Date.now();
          return <NavBar data={data} cartSlot={<CartIndicator />} />;
        }}
      />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto">
          {/* Content wrapper — fetches CMS layout, gates breadcrumbs */}
          <TracedBoundary
            name="Content"
            boundaryPath="Layout.Content"
            renderCostMs={2}
            fallback={
              <div className="px-6 py-3">
                <div className="h-[20] bg-zinc-800 rounded w-64 animate-pulse" />
              </div>
            }
            render={async (ref) => {
              await executeGqlQuery(
                "getContentLayout",
                "Layout.Content",
                mockContentLayout,
              );
              ref.ts = Date.now();
              return (
                <TracedBoundary
                  name="Breadcrumbs"
                  boundaryPath="Layout.Content.Breadcrumbs"
                  renderCostMs={5}
                  fallback={
                    <div className="px-6 py-2">
                      <div className="h-6 bg-zinc-800 rounded w-64 animate-pulse" />
                    </div>
                  }
                  render={async (ref) => {
                    const crumbs = await executeGqlQuery(
                      "getBreadcrumbs",
                      "Layout.Content.Breadcrumbs",
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
              <HeroImage
                imageUrl={heroData.heroImage}
                favoriteSlot={<FavoriteButton />}
              />

              {/* Thumbnails — own query, own boundary */}
              <TracedBoundary
                name="Thumbnails"
                boundaryPath="Layout.Content.Main.Thumbnails"
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
                    "Layout.Content.Main.Thumbnails",
                    mockThumbnails,
                  );
                  ref.ts = Date.now();
                  return <Thumbnails thumbnails={data.thumbnails} />;
                }}
              />
            </div>

            {/* Right: product info */}
            <div className="md:w-1/2 md:py-6 md:pl-6">
              {/* Title — getProductInfo (product.core + product.bullets) */}
              <TracedBoundary
                name="Title"
                boundaryPath="Layout.Content.Main.Title"
                renderCostMs={5}
                fallback={
                  <div className="px-6 md:px-0 pb-4 space-y-2">
                    {/* Title */}
                    <div className="h-9 bg-zinc-800 rounded w-3/4 animate-pulse mb-3" />
                    {/* Description */}
                    <div className="h-6 bg-zinc-800 rounded w-full animate-pulse mb-4" />
                    {/* Rating */}
                    <div className="h-5 bg-zinc-800 rounded w-48 animate-pulse" />
                  </div>
                }
                render={async (ref) => {
                  const info = await executeGqlQuery(
                    "getProductInfo",
                    "Layout.Content.Main.Title",
                    () => mockProductInfo(sku),
                  );
                  ref.ts = Date.now();
                  return <ProductSummary product={info} />;
                }}
              />

              {/* Pricing — getProductPricing (intentionally slow ~500ms) */}
              <TracedBoundary
                name="Pricing"
                boundaryPath="Layout.Content.Main.Pricing"
                renderCostMs={3}
                fallback={
                  <div className="px-6 md:px-0 space-y-2">
                    <div className="h-8 bg-zinc-800 rounded w-40 animate-pulse my-3" />
                    <div className="h-4 bg-zinc-800 rounded w-36 animate-pulse my-3" />
                  </div>
                }
                render={async (ref) => {
                  const pricing = await executeGqlQuery(
                    "getProductPricing",
                    "Layout.Content.Main.Pricing",
                    mockProductPricing,
                  );
                  ref.ts = Date.now();
                  return (
                    <>
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
                name="Bullets"
                boundaryPath="Layout.Content.Main.Bullets"
                renderCostMs={3}
                fallback={
                  <div className="px-6 md:px-0 border-t border-zinc-800 space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-4 bg-zinc-800 rounded w-full animate-pulse mt-4 mb-4"
                      />
                    ))}
                  </div>
                }
                render={async (ref) => {
                  const info = await executeGqlQuery(
                    "getProductInfo",
                    "Layout.Content.Main.Bullets",
                    () => mockProductInfo(sku),
                  );
                  ref.ts = Date.now();
                  return <ProductBullets data={info} />;
                }}
              />

              {/* Options — getProductInfo cache hit → variants */}
              <TracedBoundary
                name="Options"
                boundaryPath="Layout.Content.Main.Options"
                renderCostMs={3}
                fallback={
                  <div className="px-6 md:px-0 py-3 border-t border-zinc-800 space-y-2">
                    <div className="h-10 bg-zinc-800 rounded w-48 animate-pulse" />
                  </div>
                }
                render={async (ref) => {
                  const info = await executeGqlQuery(
                    "getProductInfo",
                    "Layout.Content.Main.Options",
                    () => mockProductInfo(sku),
                  );
                  ref.ts = Date.now();
                  return <ProductOptions data={info} />;
                }}
              />

              {/* AddToCart — standalone, no query needed */}
              <TracedBoundary
                name="AddToCart"
                boundaryPath="Layout.Content.Main.AddToCart"
                renderCostMs={1}
                fallback={
                  <div className="px-6 md:px-0 py-3 border-t border-zinc-800">
                    <div className="h-12 bg-zinc-800 rounded w-full animate-pulse" />
                  </div>
                }
                render={async (ref) => {
                  ref.ts = Date.now();
                  return <AddToCart />;
                }}
              />
            </div>
          </div>

          {/* Carousels — grouped: reco + product cards + pricing batch */}
          <TracedBoundary
            name="Carousels"
            boundaryPath="Layout.Content.Carousels"
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
                "Layout.Content.Carousels",
                mockCarousels,
              );
              ref.ts = Date.now();
              return <Carousels data={data} />;
            }}
          />

          {/* Reviews — reviews.list subgraph (slowest) */}
          <TracedBoundary
            name="Reviews"
            boundaryPath="Layout.Content.Reviews"
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
                "Layout.Content.Reviews",
                mockReviews,
              );
              ref.ts = Date.now();
              return <Reviews data={data} />;
            }}
          />

          {/* Q&A — loaded client-side via getReviewsQA CSR query */}
          <ReviewsQA />

          {/* Link to dashboard */}
          <div className="px-6 py-6 border-t border-zinc-800 text-center">
            <a
              href="/dashboard"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              View Critical Path Dashboard &rarr;
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <TracedBoundary
        name="Footer"
        boundaryPath="Layout.Footer"
        renderCostMs={5}
        fallback={
          <div className="bg-zinc-900 border-t border-zinc-800 h-48 animate-pulse" />
        }
        render={async (ref) => {
          const data = await executeGqlQuery(
            "getFooter",
            "Layout.Footer",
            mockFooterData,
          );
          ref.ts = Date.now();
          return <Footer data={data} />;
        }}
      />

      {/* Embed metrics in HTML — streams in after all boundaries complete.
          Includes MetricsCollector client component that persists to localStorage. */}
      <MetricsEmbed requestId={ctx.requestId} />
    </ClientQueryOrchestrator>
  );
}
