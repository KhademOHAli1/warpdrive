import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SubscribersNavigation } from "@/features/newsletter/audience/SubscribersNavigation";
import { hasNewsletterPermission } from "@/features/newsletter/permissions";
import { createContext } from "@/server/trpc/context";

export default async function SubscribersLayout({ children }: { children: ReactNode }) {
  const { actor } = await createContext();
  if (!hasNewsletterPermission(actor, "operate")) notFound();
  return (
    <div className="min-w-0 space-y-5">
      <SubscribersNavigation />
      {children}
    </div>
  );
}
