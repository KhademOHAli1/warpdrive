import { listDefs } from "@/features/custom-fields/defsRepo";
import { EMPTY_REF_LABELS } from "@/features/custom-fields/refLabelsShared";
import type { LocalePreferences } from "@/features/i18n/preferences";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import type { AppContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";
import { type BoardViewState, boardViewDefinition } from "./boardView";
import { resolveInitialBoardView } from "./initialBoardView";
import { rowToView } from "./savedFilterView";

const FIRST_PAGE = 50;
const COUNT_ONLY = 1;

export async function loadDealListPageData(
  ctx: AppContext & { actor: NonNullable<AppContext["actor"]> },
  args: { pipelineId: string; archived: boolean; viewPreferences?: LocalePreferences },
): Promise<{
  list: Awaited<ReturnType<ReturnType<typeof createCaller>["deal"]["list"]>>;
  prefs: Awaited<ReturnType<typeof getPreferencesForActor>>;
  customFieldDefs: Awaited<ReturnType<typeof listDefs>>;
  baseCurrency: Awaited<ReturnType<typeof readBaseCurrency>>;
  initialView: BoardViewState;
  unfilteredTotal: number | undefined;
}> {
  const caller = createCaller(ctx);
  const prefsPromise = getPreferencesForActor(ctx.db, ctx.actor.id);
  const viewPromise = prefsPromise.then((p) =>
    resolveInitialBoardView(p.ui, async () => (await caller.deal.savedFilters()).map(rowToView)),
  );
  void viewPromise.catch(() => {});
  const listPromise = viewPromise.then((view) =>
    boardViewDefinition(view) === null
      ? Promise.resolve({
          rows: [],
          total: 0,
          totalValue: null,
          currencyTotals: [],
          refLabels: EMPTY_REF_LABELS,
        })
      : caller.deal.list({
          pipelineId: args.pipelineId,
          offset: 0,
          limit: FIRST_PAGE,
          archived: args.archived,
          definition: boardViewDefinition(view) ?? undefined,
          ...args.viewPreferences,
        }),
  );
  void listPromise.catch(() => {});
  const unfilteredPromise = viewPromise.then((view) =>
    boardViewDefinition(view) === undefined || boardViewDefinition(view) === null
      ? undefined
      : caller.deal
          .list({
            pipelineId: args.pipelineId,
            offset: 0,
            limit: COUNT_ONLY,
            archived: args.archived,
          })
          .then((r) => r.total),
  );
  void unfilteredPromise.catch(() => {});

  const [list, prefs, customFieldDefs, baseCurrency, initialView, unfilteredTotal] =
    await Promise.all([
      listPromise,
      prefsPromise,
      listDefs(ctx.db, "deal", {}, AbortSignal.timeout(8000)),
      readBaseCurrency(ctx.db, AbortSignal.timeout(8000)),
      viewPromise,
      unfilteredPromise,
    ]);
  return { list, prefs, customFieldDefs, baseCurrency, initialView, unfilteredTotal };
}
