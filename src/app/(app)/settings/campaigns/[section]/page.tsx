import { notFound } from "next/navigation";
import { settingsSectionSchema } from "@/features/newsletter/admin/contracts";
import { CampaignSettingsPage } from "@/features/newsletter/admin/SettingsPage";

export default async function CampaignSettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const section = settingsSectionSchema.safeParse((await params).section);
  if (!section.success) notFound();
  return <CampaignSettingsPage section={section.data} />;
}
