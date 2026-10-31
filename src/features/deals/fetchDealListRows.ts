import type { CurrencyTotal } from "@/features/currencies/money";
import type { CustomFieldRefLabels } from "@/features/custom-fields/refLabelsContext";
import type { LocalePreferences } from "@/features/i18n/preferences";
import type { FilterDefinition } from "@/features/saved-filters/schemas";
import type { trpc } from "@/lib/trpc-client";
import type { DealListRow } from "./DealList";

export interface DealListPage {
  rows: DealListRow[];
  total: number;
  totalValue: string | null;
  currencyTotals?: CurrencyTotal[];
  refLabels: CustomFieldRefLabels;
}

interface DealListFetchArgs {
  pipelineId: string;
  archived: boolean;
  definition: FilterDefinition | undefined;
  preferences?: LocalePreferences;
}

export async function fetchDealListRows(
  utils: ReturnType<typeof trpc.useUtils>,
  args: DealListFetchArgs,
  signal: AbortSignal,
): Promise<DealListPage> {
  signal.throwIfAborted();
  const res = await utils.client.deal.list.query(
    {
      pipelineId: args.pipelineId,
      offset: 0,
      limit: 500,
      archived: args.archived ? true : undefined,
      definition: args.definition,
      timeZone: args.preferences?.timeZone ?? "UTC",
      calendar: args.preferences?.calendar,
      locale: args.preferences?.locale,
    },
    { signal },
  );
  signal.throwIfAborted();
  return {
    rows: res.rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    total: res.total,
    totalValue: res.totalValue,
    currencyTotals: res.currencyTotals,
    refLabels: res.refLabels,
  };
}
