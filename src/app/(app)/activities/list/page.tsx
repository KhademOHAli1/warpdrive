import { redirect } from "next/navigation";
import { env } from "@/config/env";
import { ActivitiesTable } from "@/features/activities/ActivitiesTable";
import { activitiesMessagesForLocale } from "@/features/activities/activitiesMessages";
import { getLocalePreferences } from "@/features/i18n/server";
import { createContext } from "@/server/trpc/context";

export async function generateMetadata() {
  return { title: activitiesMessagesForLocale((await getLocalePreferences()).locale).activities };
}

// The Activities to-do list (Pipedrive parity): a table with List/Calendar toggle, an
// owner/completed/date-range filter toolbar, type tabs driven by listTypes, and a done checkbox.
// ActivitiesTable fetches its own data via tRPC (activities.listRows), so this page only guards
// auth and renders it.
export default async function ActivityListPage(): Promise<React.ReactNode> {
  const S = activitiesMessagesForLocale((await getLocalePreferences()).locale);
  const ctx = await createContext();
  if (ctx.actor === null) {
    redirect("/login");
  }
  return (
    <main aria-label={S.activities} className="h-full">
      <ActivitiesTable
        currentUserId={ctx.actor.id}
        queueEnabled={env.SALES_NEXT_ACTION_QUEUE_ENABLED}
      />
    </main>
  );
}
