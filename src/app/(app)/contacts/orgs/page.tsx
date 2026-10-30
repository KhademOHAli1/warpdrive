import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { ListSectionSkeleton } from "@/components/shell/skeletons";
import { OrgsList } from "@/features/contacts/OrgsList";
import { QuickAddContact } from "@/features/contacts/QuickAddContact";
import { listDefs } from "@/features/custom-fields/defsRepo";
import { getAppTranslations } from "@/features/i18n/server";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import { createContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";

export async function generateMetadata() {
  const t = await getAppTranslations("contacts");
  return { title: t("organizations") };
}

// Contacts: a paginated, visibility-filtered list of organizations. The heading renders
// immediately; the row data streams into the <Suspense> boundary so a navigation shows the real
// page chrome without waiting on the list query.
export default async function OrgsListPage(): Promise<React.ReactNode> {
  const t = await getAppTranslations("contacts");
  const ctx = await createContext();
  if (ctx.actor === null) {
    redirect("/login");
  }
  return (
    <main aria-label={t("organizations")} className="flex flex-col gap-4">
      <PageHeading
        crumbs={[{ label: t("contacts"), href: "/contacts/people" }, { label: t("organizations") }]}
        title={t("organizations")}
        description={t("directory.orgsDescription")}
        actions={<QuickAddContact kind="org" triggerLabel={t("directory.addOrg")} />}
      />
      <Suspense fallback={<ListSectionSkeleton />}>
        <OrgsSection actorId={ctx.actor.id} />
      </Suspense>
    </main>
  );
}

// Data region: fetched inside the Suspense boundary so the heading above never waits on it.
// createContext is React.cache-wrapped, so re-resolving the actor here reuses the page's work.
async function OrgsSection({ actorId }: { actorId: string }): Promise<React.ReactNode> {
  const t = await getAppTranslations("contacts");
  const ctx = await createContext();
  const caller = createCaller(ctx);
  const [{ rows, total, refLabels }, prefs, customFieldDefs, baseCurrency] = await Promise.all([
    caller.contacts.listOrgs({ offset: 0, limit: 50 }),
    getPreferencesForActor(ctx.db, actorId),
    listDefs(ctx.db, "organization", {}, AbortSignal.timeout(8000)),
    readBaseCurrency(ctx.db, AbortSignal.timeout(8000)),
  ]);
  return (
    <OrgsList
      rows={rows.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        customFields: r.customFields,
        peopleCount: r.peopleCount,
        closedDeals: r.closedDeals,
        openDeals: r.openDeals,
      }))}
      total={total}
      initialColumns={prefs.ui.orgsView}
      customFieldDefs={customFieldDefs}
      baseCurrency={baseCurrency}
      refLabels={refLabels}
      emptyAction={<QuickAddContact kind="org" triggerLabel={t("directory.addOrg")} />}
    />
  );
}
