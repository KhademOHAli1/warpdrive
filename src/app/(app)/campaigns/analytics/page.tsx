import { CampaignAnalytics } from "@/features/newsletter/campaigns/CampaignAnalytics";

export default async function CampaignAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const parsed = typeof id === "string" && /^[1-9]\d*$/.test(id) ? Number(id) : undefined;
  return (
    <CampaignAnalytics
      initialId={parsed !== undefined && parsed <= 2_147_483_647 ? parsed : undefined}
    />
  );
}
