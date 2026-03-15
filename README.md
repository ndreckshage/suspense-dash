# Suspense Dash (Prototype)

A prototype dashboard for visualizing React Server Component rendering performance at the Suspense boundary level. Uses a simulated ecommerce PDP with a federated GraphQL backend — all self-contained, no external dependencies.

**This is a proof-of-concept**, not production software. The PDP, GraphQL backend, and metrics are all simulated. The goal is to demonstrate an instrumentation and visualization approach that could be adapted to real applications.

## What This Is

Traditional APM tools like Datadog show you that a request was slow, but not **where in the React component tree** the time was spent. This prototype explores that gap.

It instruments a mock ecommerce PDP with 14 Suspense boundaries, simulates a federated GraphQL backend with 9 subgraphs, and collects granular metrics that break down each boundary's performance into:

- **Fetch duration** — async I/O time (non-blocking, can overlap with other boundaries)
- **Render cost** — synchronous CPU time (blocks the Node.js thread)
- **Blocked time** — time a boundary waited for the thread after its fetch resolved
- **Wall time** — total time from request start to boundary completion

The dashboard visualizes these metrics across multiple page loads with percentile analysis (p50–p99).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌──────────────┐  ┌────────────────────────────────┐   │
│  │ PDP Page     │  │ Dashboard                      │   │
│  │ (SSR + CSR)  │──│ • Suspense Path Waterfall      │   │
│  │              │  │ • Boundary Tree Table           │   │
│  │ MetricsCollector│ • Subgraph Call Analysis        │   │
│  │  ↓           │  │                                │   │
│  │ localStorage │──│ clientMetricsStore.getMetrics() │   │
│  └──────────────┘  └────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Server (Node.js)                                       │
│  ┌──────────────────────────────────┐                   │
│  │ TracedBoundary (×14)             │                   │
│  │  → executeGqlQuery()             │                   │
│  │  → busyWait(renderCostMs)        │                   │
│  │  → metricsStore.record()         │                   │
│  ├──────────────────────────────────┤                   │
│  │ MetricsEmbed                     │                   │
│  │  waits for all 14 boundaries     │                   │
│  │  embeds JSON in <script> tag     │                   │
│  ├──────────────────────────────────┤                   │
│  │ GQL Federation Simulation        │                   │
│  │  9 subgraphs with latency models │                   │
│  │  React cache() for query dedup   │                   │
│  └──────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Next.js 16** (App Router, React Server Components, React 19)
- **TypeScript**
- **Tailwind CSS v4**
- **Bun** (package manager & runtime)
- No external API dependencies — entirely self-contained

## How It Works

### PDP Page (`/products/[sku]`)

A simulated ecommerce product page with 14 Suspense boundaries arranged in a realistic hierarchy:

```
Layout
├─ Nav
├─ Content
│  └─ Breadcrumbs
├─ Hero (non-suspense, JS fallback)
├─ Thumbnails
├─ Title
├─ Pricing
├─ Bullets
├─ Options
├─ AddToCart (static)
├─ Carousels
├─ Reviews
├─ ReviewsQA (CSR, post-hydration)
└─ Footer
```

Each boundary is wrapped in `TracedBoundary`, which measures:

1. When the boundary started executing (wall clock offset from request start)
2. How long the async fetch took (I/O)
3. How long sync rendering took (CPU, via `busyWait`)
4. How long the boundary was blocked waiting for the thread

### GraphQL Federation Simulation

Simulates 9 backend subgraphs with realistic latency distributions:

| Subgraph        | Base Latency | Notes                                           |
| --------------- | ------------ | ----------------------------------------------- |
| product         | 45ms         | Core product data                               |
| pricing         | 350ms        | Slowest — pricing + inventory + reviews summary |
| inventory       | 40ms         | Availability checks                             |
| reviews         | 50–350ms     | Wide range by operation                         |
| cms             | 40–90ms      | Navigation, breadcrumbs                         |
| reco            | 180ms        | Recommendation engine                           |
| experimentation | 30ms         | A/B test context                                |
| media           | 35–50ms      | Image/thumbnail URLs                            |
| user            | 60–80ms      | Cart (CSR only)                                 |

Latency follows a realistic tail distribution: 85% tight cluster, 11% moderately slow (1.3–1.8×), 3.5% slow (2–3×), 0.5% extreme tail (3–5×, simulating GC pauses or cold starts).

**Query dedup**: Uses React's `cache()` for request-scoped deduplication. For example, `getProductInfo` is called by Title, Bullets, and Options boundaries but only executes once — the dashboard shows this.

### Metrics Collection Pipeline

1. **Server**: Each `TracedBoundary` records metrics to an in-memory store
2. **Server**: `MetricsEmbed` waits for all 14 boundaries, embeds metrics as a `<script type="application/json">` tag
3. **Client**: `MetricsCollector` reads the embedded JSON, deduplicates, and stores to `localStorage`
4. **Client**: `PerformanceObserver` captures Long Animation Frame (LoAF) entries for 5 seconds post-load
5. **Client**: Navigation timing (DOM events, TBT) collected via Performance API

### Dashboard (`/dashboard`)

Three visualization tabs:

**Suspense Path** — A waterfall chart showing boundary execution timeline across SSR queries, SSR main thread renders, CSR queries, and CSR main thread (LoAF). Marker lines track LCP data ready, LCP render, hydration, and init complete milestones. Blocks are color-coded by component. Hover for fetch/render/blocked breakdown.

**Boundary Tree** — Hierarchical table view: boundaries → queries → subgraph operations. Expandable rows show query dedup detection (cached vs actual execution). Filterable by LCP path (shows only LCP-critical boundaries and ancestors) or by subgraph. Latencies aggregated by selected percentile with SLO status indicators.

**Subgraph Calls** — Aggregated view of subgraph utilization: calls per request, dedup rate, per-operation breakdown by boundary, client vs server phase separation.

All tabs support percentile selection (p50, p75, p90, p95, p99) and page type filtering.

### Navigation

- **PDP page** includes a "View Dash" link and a **Slow Mode toggle** in the nav bar
- **Dashboard** includes a "View Demo" link in the header

## Getting Started

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Click through to the **PDP page** — each load collects metrics
2. Load the page several times to build up a dataset
3. Visit the **Dashboard** to explore the metrics
4. Use "Load demo data" on the dashboard for pre-populated sample data

### Slow Mode

Toggle via the "Slow" button in the PDP nav bar (or add `?slow=1` to the URL). Multiplies all latencies by 20× — useful for visually observing Suspense streaming behavior.

## Key Files

| File                              | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `app/products/[sku]/page.tsx`     | PDP with 14 traced Suspense boundaries |
| `app/dashboard/page.tsx`          | Metrics dashboard (client component)   |
| `components/TracedBoundary.tsx`   | Core instrumentation wrapper           |
| `components/MetricsEmbed.tsx`     | Server → client metrics transport      |
| `components/MetricsCollector.tsx` | Client-side metrics ingestion          |
| `lib/metrics-store.ts`            | Metric types + server-side store       |
| `lib/client-metrics-store.ts`     | Client localStorage store + seed logic |
| `lib/gql-federation.ts`           | Subgraph & query definitions           |
| `lib/gql-query.ts`                | Query execution + dedup via cache()    |
| `lib/busy-wait.ts`                | Sync thread-blocking simulation        |
| `components/dashboard/*`          | Dashboard tab components               |
| `components/pdp/*`                | PDP UI components                      |

## Production Path

This prototype uses simulated data and localStorage. For production use, the key integration points would be:

1. **Replace simulated queries with real GraphQL calls** — the `TracedBoundary` instrumentation pattern works with real async operations, not just mocked ones
2. **Ship metrics to a remote store** — replace localStorage with writes to Datadog custom metrics, BigQuery, or a time-series database
3. **Read metrics from remote sources** — dashboard API layer that queries Datadog Metrics API or BigQuery instead of localStorage
4. **Deploy the dashboard as an internal tool** — separate from the production app, reading from the same metric sources

See the [Production Integration](#production-integration) discussion below for a detailed Datadog integration path.

### Production Integration

**Writing metrics to Datadog:**

- Use `dd-trace` or the Datadog API to emit custom metrics from `TracedBoundary` (boundary timing, query durations, subgraph latencies)
- Tag metrics with boundary path, query name, subgraph, request ID, and page type
- Emit as distributions (not gauges) to get server-side percentile aggregation

**Reading metrics back for this dashboard:**

- Datadog Metrics Query API (`/api/v1/query`) supports percentile queries on distribution metrics
- Datadog APM has a Trace Search API for span-level data (boundary execution details)
- Rate limits are generous for internal dashboards (~300 req/min for metrics queries)

**BigQuery alternative:**

- Stream boundary metrics to GBQ via a lightweight collector (pub/sub or direct insert)
- Dashboard queries GBQ directly — better for custom aggregations and historical analysis
- Lower cost for high-cardinality data (per-boundary, per-request granularity)

**Hybrid approach (recommended):**

- Write to Datadog for alerting, on-call dashboards, and correlation with existing APM
- Write to GBQ for this custom dashboard's detailed analysis (waterfall, tree, dedup visualization)
- Use Datadog for "is rendering slow?" and this dashboard for "why is rendering slow?"
