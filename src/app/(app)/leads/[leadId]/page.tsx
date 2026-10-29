import type { Metadata } from "next";
import type React from "react";
import { getAppTranslations } from "@/features/i18n/server";
import { entityTitle } from "@/features/navigation/pageTitle";
import { LeadDetailView, loadLead } from "./LeadDetailView";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ leadId: string }>;
}): Promise<Metadata> {
  const t = await getAppTranslations("leads");
  const { leadId } = await params;
  const loaded = await loadLead(leadId);
  const name = loaded.kind === "ok" ? loaded.lead.title : null;
  return { title: entityTitle(name, t("leadText")) };
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}): Promise<React.ReactNode> {
  const { leadId } = await params;
  return <LeadDetailView leadId={leadId} />;
}
