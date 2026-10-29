import { redirect } from "next/navigation";
import { PageHeading } from "@/components/shell/PageHeading";
import { getAppTranslations } from "@/features/i18n/server";
import { createContext } from "@/server/trpc/context";
import { EngagementTimelineClient } from "./EngagementTimelineClient";

export async function generateMetadata() {
  const t = await getAppTranslations("contacts");
  return { title: t("contactsTimeline") };
}

// Contacts nav: the per-contact engagement timeline (CO-4), Pipedrive parity. Activities rolled up
// per visible person/org, bucketed by month, with entity/period/owner/type filters. The client
// fetches its own data via contacts.engagementTimeline, so this page only guards auth.
export default async function ContactsTimelinePage(): Promise<React.ReactNode> {
  const t = await getAppTranslations("contacts");
  const ctx = await createContext();
  if (ctx.actor === null) {
    redirect("/login");
  }

  return (
    <main aria-label={t("contactsTimeline")} className="flex flex-col gap-4">
      <PageHeading
        crumbs={[
          { label: t("contacts"), href: "/contacts/people" },
          { label: t("contactsTimeline") },
        ]}
        title={t("contactsTimeline")}
      />
      <EngagementTimelineClient />
    </main>
  );
}
