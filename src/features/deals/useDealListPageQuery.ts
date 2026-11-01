"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { EMPTY_REF_LABELS } from "@/features/custom-fields/refLabelsContext";
import type { LocalePreferences } from "@/features/i18n/preferences";
import { hasDateCondition } from "@/features/saved-filters/filterFields";
import { trpc } from "@/lib/trpc-client";
import { type BoardViewState, boardViewDefinition, DEFAULT_BOARD_VIEW } from "./boardView";
import { dealListQueryKey } from "./dealListQueryKey";
import { type DealListPage, fetchDealListRows } from "./fetchDealListRows";

type ListSeed = Pick<DealListPage, "rows" | "total" | "totalValue"> &
  Partial<Pick<DealListPage, "currencyTotals" | "refLabels">> & { initialView?: BoardViewState };

function seedPage(initial: ListSeed, view: BoardViewState): DealListPage | undefined {
  const definition = boardViewDefinition(view);
  if (
    definition === null ||
    JSON.stringify(definition ?? null) !==
      JSON.stringify(boardViewDefinition(initial.initialView ?? DEFAULT_BOARD_VIEW) ?? null)
  )
    return undefined;
  return {
    rows: initial.rows,
    total: initial.total,
    totalValue: initial.totalValue,
    currencyTotals: initial.currencyTotals ?? [],
    refLabels: initial.refLabels ?? EMPTY_REF_LABELS,
  };
}

// Query admission and presentation are both closed while a selected view cannot be decoded.
// The distinct cache key also prevents an unavailable state borrowing the all-records cache.
export function useDealListPageQuery(args: {
  view: BoardViewState;
  initial: ListSeed;
  pipelineId: string;
  variant: string;
  preferences: LocalePreferences;
  preferencePending: boolean;
}) {
  const utils = trpc.useUtils();
  const { view, initial, pipelineId, variant, preferences, preferencePending } = args;
  const definition = boardViewDefinition(view);
  const viewUnavailable = definition === null;
  const activeDefinition = definition ?? undefined;
  const dateCondition = hasDateCondition(activeDefinition);
  const query = useQuery({
    queryKey: viewUnavailable
      ? ["unavailable-saved-view", pipelineId, view.savedFilter?.id]
      : dealListQueryKey(pipelineId, variant, activeDefinition, preferences),
    enabled: !viewUnavailable && (!dateCondition || !preferencePending),
    queryFn: ({ signal }) =>
      viewUnavailable
        ? Promise.resolve({
            rows: [],
            total: 0,
            totalValue: null,
            currencyTotals: [],
            refLabels: EMPTY_REF_LABELS,
          })
        : fetchDealListRows(
            utils,
            {
              pipelineId,
              archived: variant === "archived",
              definition: activeDefinition,
              preferences,
            },
            signal,
          ),
    initialData: seedPage(initial, view),
    initialDataUpdatedAt: dateCondition || initial.rows.length < initial.total ? 0 : undefined,
    placeholderData: viewUnavailable ? undefined : keepPreviousData,
    staleTime: 5_000,
  });
  return {
    activeDefinition,
    viewUnavailable,
    data: viewUnavailable || query.isPlaceholderData ? undefined : query.data,
    isError: query.isError,
    retry: () => {
      void query.refetch();
    },
    isPlaceholderData: query.isPlaceholderData,
  };
}
