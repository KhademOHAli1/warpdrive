import { cardFromDealAck } from "./boardAck";
import type { DealListRow } from "./dealListTypes";
import type { DealActionSnapshot } from "./dealVersion";

export function listRowFromDealAck(previous: DealListRow, deal: DealActionSnapshot): DealListRow {
  const card = cardFromDealAck(deal, { ...previous, updatedAt: new Date(previous.updatedAt) });
  return {
    ...card,
    updatedAt: deal.updatedAt,
    customFields:
      deal.customFields !== null &&
      typeof deal.customFields === "object" &&
      !Array.isArray(deal.customFields)
        ? (deal.customFields as Record<string, unknown>)
        : {},
  };
}
