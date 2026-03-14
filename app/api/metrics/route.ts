import { NextResponse } from "next/server";
import { metricsStore } from "@/lib/metrics-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const metrics = metricsStore.getMetrics();
  return NextResponse.json(metrics);
}

export async function DELETE() {
  metricsStore.clear();
  return NextResponse.json({ ok: true });
}
