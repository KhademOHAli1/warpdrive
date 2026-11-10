import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createContext } from "@/server/trpc/context";

export default async function CampaignsLayout({ children }: { children: ReactNode }) {
  const { actor } = await createContext();
  if (actor?.type !== "admin") notFound();
  return children;
}
