import type { MouseEvent } from "react";
import type { StocktakeDetail, StocktakeIntent, StocktakeLine } from "../contracts";

export type StocktakeEditor =
  | { type: "startCount" | "captureValuation" }
  | { type: "recordCounts" | "reconcileCount" | "cancelCount"; stocktake: StocktakeDetail };

export type OpenStocktakeEditor = (
  event: MouseEvent<HTMLButtonElement>,
  editor: StocktakeEditor,
) => void;

export type StocktakeDialogProps = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: StocktakeIntent) => void;
};

export function stocktakeHref(
  siteId: string,
  detail?: { stocktakeId: string } | { valuationId: string },
) {
  const params = new URLSearchParams({ siteId, ...detail });
  return `/inventory/warehouse/stocktakes?${params.toString()}`;
}

export function stocktakeLineLabel(
  line: Pick<StocktakeLine, "code" | "revision" | "lot" | "serial">,
) {
  return [line.code, line.revision, line.lot, line.serial].filter(Boolean).join(" · ");
}
