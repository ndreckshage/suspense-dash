import { sleep } from "./sleep";

/**
 * Simulates a fetch with realistic latency variance.
 * Adds ±20% jitter to the base latency.
 */
export async function simulatedFetch<T>(
  baseMs: number,
  data: T
): Promise<T> {
  const jitter = baseMs * 0.4 * (Math.random() - 0.5);
  const actualMs = Math.max(10, Math.round(baseMs + jitter));
  await sleep(actualMs);
  return data;
}

// --- Mock data generators ---

export function mockNavData() {
  return {
    categories: [
      { name: "Electronics", href: "/c/electronics" },
      { name: "Computers", href: "/c/computers" },
      { name: "Audio", href: "/c/audio" },
      { name: "Accessories", href: "/c/accessories" },
    ],
    logo: "ACME Store",
  };
}

export function mockSessionConfig() {
  return {
    userId: "usr_abc123",
    featureFlags: { newCheckout: true, darkMode: true },
  };
}

export function mockProductData(sku: string) {
  return {
    sku,
    name: "Premium Wireless Headphones",
    brand: "SoundMax",
    heroImageUrl: "/placeholder-hero.svg",
    shortDescription:
      "Immersive sound with active noise cancellation and 30-hour battery life.",
    rating: 4.6,
    reviewCount: 1247,
  };
}

export function mockBreadcrumbs() {
  return [
    { name: "Home", href: "/" },
    { name: "Electronics", href: "/c/electronics" },
    { name: "Audio", href: "/c/audio" },
    { name: "Headphones", href: "/c/headphones" },
  ];
}

export function mockProductDetails() {
  return {
    price: 249.99,
    originalPrice: 349.99,
    currency: "USD",
    inStock: true,
    variants: [
      { name: "Midnight Black", value: "black", available: true },
      { name: "Arctic White", value: "white", available: true },
      { name: "Navy Blue", value: "blue", available: false },
    ],
    specs: [
      { label: "Battery Life", value: "30 hours" },
      { label: "Driver Size", value: "40mm" },
      { label: "Connectivity", value: "Bluetooth 5.3" },
      { label: "Weight", value: "250g" },
    ],
  };
}

export function mockCarousels() {
  return {
    title: "You might also like",
    items: Array.from({ length: 8 }, (_, i) => ({
      id: `rec-${i}`,
      name: `Product ${i + 1}`,
      price: Math.round(49.99 + Math.random() * 200),
      imageUrl: `/placeholder-rec-${i}.svg`,
      rating: Math.round((3.5 + Math.random() * 1.5) * 10) / 10,
    })),
  };
}

export function mockReviews() {
  const reviewTexts = [
    "Amazing sound quality! Best headphones I've ever owned.",
    "Comfortable for long listening sessions. Battery is incredible.",
    "Good noise cancellation but a bit pricey.",
    "The build quality is fantastic. Very premium feel.",
    "Decent headphones but the app could be better.",
    "Perfect for travel. The ANC is top-notch.",
  ];
  return {
    summary: { average: 4.6, total: 1247, distribution: [5, 62, 23, 7, 3] },
    reviews: reviewTexts.map((text, i) => ({
      id: `rev-${i}`,
      author: `User${1000 + i}`,
      rating: Math.min(5, 3 + Math.floor(Math.random() * 3)),
      text,
      date: new Date(Date.now() - i * 86400000 * 3).toISOString(),
      helpful: Math.floor(Math.random() * 50),
    })),
  };
}

export function mockFooterData() {
  return {
    columns: [
      {
        title: "Shop",
        links: ["All Products", "Deals", "New Arrivals", "Best Sellers"],
      },
      {
        title: "Support",
        links: ["Contact Us", "FAQ", "Returns", "Shipping"],
      },
      {
        title: "Company",
        links: ["About", "Careers", "Press", "Blog"],
      },
    ],
    copyright: "2026 ACME Store. All rights reserved.",
  };
}
