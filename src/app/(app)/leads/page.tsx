import { db } from "@/db/client";
import { listDefs } from "@/features/custom-fields/defsRepo";
import { getAppTranslations } from "@/features/i18n/server";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { toLeadSort } from "@/features/leads/inbox/seedSort";
import { LeadsInbox } from "@/features/leads/LeadsInbox";
import { can } from "@/features/permissions/can";
import { resolveSavedViewSelection } from "@/features/saved-filters/savedViewSelection";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import { createContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";

export async function generateMetadata() {
  const t = await getAppTranslations("leads");
  return { title: t("leads") };
}

export default async function LeadsPage(): Promise<React.ReactNode> {
  const t = await getAppTranslations("leads");
  const ctx = await createContext();
  if (ctx.actor === null) {
    return <main>{t("unauthorized")}</main>;
  }
  const [baseCurrency, prefs, customFieldDefs] = await Promise.all([
    readBaseCurrency(db, AbortSignal.timeout(8000)),
    getPreferencesForActor(db, ctx.actor.id),
    listDefs(db, "lead", {}, AbortSignal.timeout(8000)),
  ]);
  const stored = prefs.ui.leadsView;
  const storedSelection = prefs.ui.leadsSavedViewSelection;
  const visibleViews =
    storedSelection !== undefined &&
    !("status" in storedSelection) &&
    storedSelection.savedViewId !== null
      ? await createCaller(ctx).savedFilters.listByTarget({ targetEntity: "lead" })
      : [];
  const seed = resolveSavedViewSelection(storedSelection, visibleViews);
  const initialView =
    stored !== undefined
      ? {
          columns: stored.columns,
          sort: toLeadSort(stored.sort.field, stored.sort.dir, customFieldDefs),
        }
      : null;

  return (
    <main aria-label={t("leads")} className="h-full">
      <LeadsInbox
        key={ctx.actor.id}
        preferenceActorId={ctx.actor.id}
        baseCurrency={baseCurrency}
        initialView={initialView}
        {...seed}
        customFieldDefs={customFieldDefs}
        canImport={can(ctx.actor, "data.import")}
      />
    </main>
  );
}
