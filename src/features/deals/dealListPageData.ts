import { EMPTY_REF_LABELS } from "@/features/custom-fields/refLabelsShared";
import type { LocalePreferences } from "@/features/i18n/preferences";
import type { AppContext } from "@/frontend/context";
import { getPreferencesForActor, listDefs, readBaseCurrency } from "@/frontend/reads";
import { createCaller } from "@/frontend/trpc";
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
  const prefsPromise = getPreferencesForActor();
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
      listDefs("deal"),
      readBaseCurrency(),
      viewPromise,
      unfilteredPromise,
    ]);
  return { list, prefs, customFieldDefs, baseCurrency, initialView, unfilteredTotal };
}
