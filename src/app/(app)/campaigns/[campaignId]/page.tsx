import { notFound } from "next/navigation";
import { CampaignEditor } from "@/features/newsletter/campaigns/CampaignEditor";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const id = Number(campaignId);
  if (!/^[1-9]\d*$/.test(campaignId) || !Number.isSafeInteger(id)) notFound();
  return <CampaignEditor campaignId={id} />;
}
