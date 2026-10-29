import { type CurrencyTotal, sumMoney } from "@/features/currencies/money";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { applyConditions } from "./boardConditions";
import { distinctBoardOwners, matchesOwnerFilter } from "./boardFilter";
import type { Condition } from "./boardQuickFilter";
import type { BoardSortKey, SortDirection } from "./boardSort";
import { sortBoardCards } from "./boardSort";
import type { StageMeta } from "./boardTypes";
import type { BoardCard } from "./dealRepo";

interface DerivedInput {
  liveCards: BoardCard[];
  stages: StageMeta[];
  selectedOwnerId: string | null;
  conditions: Condition[];
  sortKey: BoardSortKey;
  sortDirection: SortDirection;
  baseCurrency?: string;
}

interface Derived {
  owners: ReturnType<typeof distinctBoardOwners>;
  shownCards: BoardCard[];
  sumsByStage: Map<string, { dealCount: number; total: number; currencyTotals?: CurrencyTotal[] }>;
  boardTotal: number;
  boardTotals: CurrencyTotal[];
  sortedByStage: Map<string, BoardCard[]>;
}

// Board display derivations, all downstream of the client-side owner/saved-filter/quick-condition
// narrowing. Drag math reads the raw liveCards, not these, so filtering/sorting is display-only.
// No manual useMemo: React Compiler (enabled repo-wide) memoizes each derivation from its reactive
// inputs, so the hand-written memos were redundant.
export function useBoardDerived(input: DerivedInput): Derived {
  const { liveCards, stages, selectedOwnerId, conditions, sortKey, sortDirection } = input;

  const locale = useLocale();
  const owners = distinctBoardOwners(liveCards, locale);

  const shownCards = applyConditions(
    liveCards.filter((c) => matchesOwnerFilter(c, selectedOwnerId)),
    conditions,
  );

  const fallback = input.baseCurrency ?? "USD";
  const sumsByStage = new Map<
    string,
    { dealCount: number; total: number; currencyTotals: CurrencyTotal[] }
  >();
  for (const stage of stages) {
    const cards = shownCards.filter((card) => card.stageId === stage.id);
    const currencyTotals = sumMoney(cards, fallback);
    sumsByStage.set(stage.id, {
      dealCount: cards.length,
      currencyTotals,
      total: currencyTotals.length === 1 ? Number(currencyTotals[0]?.value ?? 0) : 0,
    });
  }
  const boardTotals = sumMoney(shownCards, fallback);
  const boardTotal = boardTotals.length === 1 ? Number(boardTotals[0]?.value ?? 0) : 0;

  const sortedByStage = new Map<string, BoardCard[]>(stages.map((s) => [s.id, []]));
  for (const c of shownCards) sortedByStage.get(c.stageId)?.push(c);
  for (const s of stages) {
    sortedByStage.set(s.id, sortBoardCards(sortedByStage.get(s.id) ?? [], sortKey, sortDirection));
  }

  return { owners, shownCards, sumsByStage, boardTotal, boardTotals, sortedByStage };
}
