import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { NextActionQueueClient } from "@/features/activities/NextActionQueueClient";
import { getAppTranslations } from "@/features/i18n/server";
import { createContext, getFrontendConfig } from "@/frontend/context";
import { ActivitiesToggle } from "../ActivitiesToggle";

export default async function NextActionQueuePage(): Promise<ReactNode> {
  const env = await getFrontendConfig();
  if (!env.SALES_NEXT_ACTION_QUEUE_ENABLED) notFound();
  const ctx = await createContext();
  if (ctx.actor === null || ctx.session === null || !ctx.actor.isActive) redirect("/login");
  const t = await getAppTranslations("nextActionQueue");
  return (
    <main aria-label={t("title")} className="h-full overflow-auto p-4">
      <ActivitiesToggle active="queue" queueEnabled />
      <NextActionQueueClient key={ctx.actor.id} currentUserId={ctx.actor.id} />
    </main>
  );
}
export async function generateMetadata() {
  const env = await getFrontendConfig();
  if (!env.SALES_NEXT_ACTION_QUEUE_ENABLED) return {};
  const t = await getAppTranslations("nextActionQueue");
  return { title: t("title") };
}
