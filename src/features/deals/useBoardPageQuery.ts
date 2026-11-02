"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocalePreferencePending, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { hasDateCondition } from "@/features/saved-filters/filterFields";
import type { FilterDefinition } from "@/features/saved-filters/schemas";
import { trpc } from "@/lib/trpc-client";
import type { BoardProps } from "./boardTypes";
import { type BoardViewState, boardViewDefinition, DEFAULT_BOARD_VIEW } from "./boardView";
import { dateFilterContextKey } from "./dealListQueryKey";
import { BOARD_QUERY_KEY } from "./useDealMove";

const EMPTY_BOARD_CARDS: BoardProps["cards"] = [];

export function useBoardPageQuery({
  pipelineId,
  view,
  previewDefinition,
  cards,
  initialView,
}: {
  pipelineId: string;
  view: BoardViewState & { restored: boolean };
  previewDefinition: FilterDefinition | null;
  cards: BoardProps["cards"];
  initialView: BoardViewState | undefined;
}) {
  const preferences = useLocalePreferences();
  const { locale, calendar, timeZone } = preferences;
  const preferencePending = useLocalePreferencePending();
  const { savedFilter, conditions: inlineDefinition } = view;
  const utils = trpc.useUtils();
  // Subscribe to the shared board cache so an optimistic move (useDealMove) or a realtime
  // event (useBoardRealtime) re-renders the board immediately, without a reload. Seeded from
  // the server-rendered cards; invalidation reconciles via the tRPC board query. This closes
  // the bug where a dropped card only appeared in its new column after an F5.
  const viewUnavailable = boardViewDefinition(view) === null;
  const activeDefinition = viewUnavailable
    ? undefined
    : (previewDefinition ?? inlineDefinition ?? savedFilter?.definition ?? undefined);
  const dateContext = hasDateCondition(activeDefinition) ? dateFilterContextKey(preferences) : null;
  const datePreferencePending = dateContext !== null && preferencePending;
  const filterKey = JSON.stringify([activeDefinition ?? null, dateContext]);
  const initialDefinition = boardViewDefinition(initialView ?? DEFAULT_BOARD_VIEW);
  const initialFilterKey = JSON.stringify([
    initialDefinition ?? null,
    hasDateCondition(initialDefinition) ? dateFilterContextKey(preferences) : null,
  ]);
  const boardQuery = useQuery({
    enabled: !viewUnavailable && !datePreferencePending,
    queryKey: BOARD_QUERY_KEY(pipelineId),
    queryFn: async ({ signal }) => {
      if (viewUnavailable) return { cards: EMPTY_BOARD_CARDS, filterKey, filterIsActive: true };
      const result = await utils.client.deal.board.query(
        {
          pipelineId,
          definition: activeDefinition,
          timeZone,
          locale,
          calendar,
        },
        { signal },
      );
      signal.throwIfAborted();
      // Do not let object spread turn an absent RPC result into a successful receipt. Required
      // data must be read before the cache can claim this scope was loaded.
      return { cards: result.cards, filterKey, filterIsActive: activeDefinition !== undefined };
    },
    initialData: {
      cards,
      filterKey: initialFilterKey,
      filterIsActive: initialDefinition !== undefined,
    },
    initialDataUpdatedAt: hasDateCondition(activeDefinition) ? 0 : undefined,
    refetchOnMount: view.restored ? "always" : true,
    staleTime: 5_000,
  });
  const viewPending =
    !viewUnavailable &&
    (boardQuery.data.filterKey !== filterKey ||
      boardQuery.isError ||
      (activeDefinition !== undefined && boardQuery.isFetching));
  const liveCards = viewUnavailable || viewPending ? EMPTY_BOARD_CARDS : boardQuery.data.cards;
  const refetch = boardQuery.refetch;
  // Re-run the (same-key) board query when the applied saved filter changes so filtering is
  // server-side while realtime patching + optimistic moves keep matching the single cache key.
  // Skip the first run: the query is already seeded with the SSR cards for the initial (null)
  // filter, so refetching on mount would be a redundant round trip that discards initialData.
  // savedFilter is a deliberate trigger dep (the queryFn closes over its definition), not used
  // in the body, so biome's exhaustive-deps check is suppressed here on purpose.
  const filterMounted = useRef(false);
  const initialScopeMismatch = useRef(boardQuery.data.filterKey !== filterKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: savedFilter/previewDefinition/dateContext are intentional refetch triggers
  useEffect(() => {
    if (!filterMounted.current) {
      filterMounted.current = true;
      if (!initialScopeMismatch.current) return;
    }
    if (viewUnavailable || datePreferencePending) return;
    void refetch();
  }, [
    savedFilter,
    previewDefinition,
    inlineDefinition,
    dateContext,
    datePreferencePending,
    viewUnavailable,
    refetch,
  ]);

  return { viewUnavailable, viewPending, liveCards, refetch, queryError: boardQuery.isError };
}
