import { DashboardClient } from "./dashboard-client";

const TAB_KEYS = ["lcp", "tree", "subgraphs"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tab = typeof params.tab === "string" ? params.tab : undefined;
  const initialTab: TabKey = TAB_KEYS.includes(tab as TabKey)
    ? (tab as TabKey)
    : "lcp";
  const run = typeof params.run === "string" ? params.run : undefined;

  return <DashboardClient initialTab={initialTab} runUrl={run} />;
}
