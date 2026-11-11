import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { hasNewsletterPermission } from "@/features/newsletter/permissions";
import { createContext } from "@/server/trpc/context";

export default async function CampaignsLayout({ children }: { children: ReactNode }) {
  const { actor } = await createContext();
  if (!hasNewsletterPermission(actor, "view")) notFound();
  return children;
}
