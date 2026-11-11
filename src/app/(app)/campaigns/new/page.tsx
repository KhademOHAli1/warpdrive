import { notFound } from "next/navigation";
import { CampaignEditor } from "@/features/newsletter/campaigns/CampaignEditor";
import { hasNewsletterPermission } from "@/features/newsletter/permissions";
import { createContext } from "@/server/trpc/context";

export default async function NewCampaignPage() {
  const { actor } = await createContext();
  if (!hasNewsletterPermission(actor, "edit")) notFound();
  return <CampaignEditor />;
}
