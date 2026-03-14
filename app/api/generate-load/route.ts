import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body.count) || 100, 1), 500);

  const baseUrl = request.nextUrl.origin;
  const url = `${baseUrl}/products/demo-sku`;

  let completed = 0;
  const errors: string[] = [];

  for (let i = 0; i < count; i++) {
    try {
      // Fire request and wait for full response (ensures all suspense boundaries resolve)
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "x-load-test": "true" },
      });
      // Consume the body to ensure all streaming completes
      await res.text();
      completed++;
    } catch (err) {
      errors.push(`Request ${i}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Small delay between requests to avoid overwhelming the server
    if (i < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return NextResponse.json({
    requested: count,
    completed,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}
