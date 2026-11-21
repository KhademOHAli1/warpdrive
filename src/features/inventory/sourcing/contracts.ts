import { z } from "zod";
import { currencyCode, moneyAmount } from "@/features/currencies/currencySchema";
import type { CatalogUnit } from "../catalog/contracts";

const id = z.uuid().toLowerCase();
const scope = { siteId: id, itemId: id, requestId: id };
const revision = {
  id: id.nullable(),
  expectedVersion: z.number().int().min(1).max(2147483646).nullable(),
};
const partNumber = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/\p{Cc}/u.test(value));
const packCount = z.number().int().min(1).max(1_000_000);
const amount = z.string().refine((value) => moneyAmount.safeParse(value).success);
const money = z.strictObject({ amount, currency: currencyCode });

export const sourcingCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("saveManufacturer"),
    ...scope,
    ...revision,
    organizationId: id,
    partNumber,
  }),
  z.strictObject({
    type: z.literal("saveOffer"),
    ...scope,
    ...revision,
    supplierOrganizationId: id,
    manufacturerPartId: id.nullable(),
    partNumber,
    packQuantity: packCount,
    approved: z.boolean(),
    available: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("setPriceTier"),
    ...scope,
    offerId: id,
    minPacks: packCount,
    currency: currencyCode,
    amount: amount.nullable(),
  }),
  z.strictObject({ type: z.literal("setCostOverride"), ...scope, cost: money.nullable() }),
]);

export const sourcingQuery = z.strictObject({ siteId: id.optional(), itemId: id.optional() });
export type SourcingQuery = z.infer<typeof sourcingQuery>;
export type SourcingCommand = z.infer<typeof sourcingCommand>;
type WithoutRequest<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type SourcingIntent = WithoutRequest<SourcingCommand>;
export type SourcingError = "unavailable" | "invalid" | "conflict" | "stale";
export type SourcingCommandResult = { ok: true } | { ok: false; error: SourcingError };

export type SourcingSite = {
  id: string;
  code: string;
  name: string;
  archived: boolean;
  canBuy: boolean;
  canViewCosts: boolean;
  canEditCosts: boolean;
};
export type SourcingPart = {
  id: string;
  code: string;
  name: string;
  revision: string;
  unit: CatalogUnit;
  canSource: boolean;
};
export type SourcingManufacturer = {
  id: string;
  organizationId: string;
  organizationName: string;
  partNumber: string;
  version: number;
};
export type SourcingOffer = {
  id: string;
  supplierOrganizationId: string;
  supplierName: string;
  manufacturerPartId: string | null;
  partNumber: string;
  packQuantity: number;
  stockUnit: CatalogUnit;
  approved: boolean;
  available: boolean;
  version: number;
};
export type SourcingMoney = z.infer<typeof money>;
export type SourcingPriceTier = SourcingMoney & { offerId: string; minPacks: number };

export type SourcingWorkspace = {
  sites: SourcingSite[];
  selectedSiteId: string | null;
  parts: SourcingPart[];
  selectedItemId: string | null;
  organizations: { id: string; name: string }[];
  manufacturers: SourcingManufacturer[];
  offers: SourcingOffer[];
  pricing?: { tiers: SourcingPriceTier[]; override: SourcingMoney | null };
};

export type SourcingResult =
  | { ok: true; value: SourcingWorkspace }
  | { ok: false; error: SourcingError };

export function calculateStockUnits(packs: number, packQuantity: number): number | null {
  if (
    !Number.isSafeInteger(packs) ||
    !Number.isSafeInteger(packQuantity) ||
    packs < 1 ||
    packQuantity < 1 ||
    packs > 1_000_000 ||
    packQuantity > 1_000_000
  ) {
    return null;
  }
  const units = packs * packQuantity;
  return units <= 1_000_000_000 ? units : null;
}

export function chooseSourcingTier(
  tiers: readonly SourcingPriceTier[],
  offerId: string,
  currency: string,
  packs: number,
): SourcingPriceTier | null {
  if (!Number.isSafeInteger(packs) || packs < 1 || packs > 1_000_000) return null;
  let selected: SourcingPriceTier | null = null;
  for (const tier of tiers) {
    if (
      tier.offerId === offerId &&
      tier.currency === currency &&
      tier.minPacks <= packs &&
      (selected === null || tier.minPacks > selected.minPacks)
    ) {
      selected = tier;
    }
  }
  return selected;
}
