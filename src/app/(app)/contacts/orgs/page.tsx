import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { ListSectionSkeleton } from "@/components/shell/skeletons";
import { OrgsList } from "@/features/contacts/OrgsList";
import { QuickAddContact } from "@/features/contacts/QuickAddContact";
import type { OrgSortField } from "@/features/contacts/schemas";
import { listDefs } from "@/features/custom-fields/defsRepo";
import { getAppTranslations } from "@/features/i18n/server";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { resolveSavedViewSelection } from "@/features/saved-filters/savedViewSelection";
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
  const prefs = await getPreferencesForActor(ctx.db, actorId);
  const storedSelection = prefs.ui.orgsSavedViewSelection;
  const visibleViews =
    storedSelection !== undefined &&
    !("status" in storedSelection) &&
    storedSelection.savedViewId !== null
      ? await caller.savedFilters.listByTarget({ targetEntity: "organization" })
      : [];
  const seed = resolveSavedViewSelection(storedSelection, visibleViews);
  const blocked =
    seed.initialSelectionBlocked || seed.initialSavedView?.availability === "unavailable";
  const selected = seed.initialSavedView;
  const sort =
    selected !== null && selected.availability !== "unavailable"
      ? selected.presentation?.sort
      : undefined;
  const [{ rows, total, refLabels }, customFieldDefs, baseCurrency] = await Promise.all([
    blocked
      ? { rows: [], total: 0, refLabels: { user: {}, person: {}, org: {} } }
      : caller.contacts.listOrgs({
          offset: 0,
          limit: 50,
          filter: selected?.definition ?? undefined,
          sort: sort as { field: OrgSortField; dir: "asc" | "desc" } | undefined,
        }),
    listDefs(ctx.db, "organization", {}, AbortSignal.timeout(8000)),
    readBaseCurrency(ctx.db, AbortSignal.timeout(8000)),
  ]);
  return (
    <OrgsList
      key={actorId}
      preferenceActorId={actorId}
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
      {...seed}
      customFieldDefs={customFieldDefs}
      baseCurrency={baseCurrency}
      refLabels={refLabels}
      emptyAction={<QuickAddContact kind="org" triggerLabel={t("directory.addOrg")} />}
    />
  );
}
