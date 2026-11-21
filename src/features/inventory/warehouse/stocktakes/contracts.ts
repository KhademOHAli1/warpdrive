import { z } from "zod";
import type { CatalogUnit } from "../../catalog/contracts";
import type { WarehouseStockState } from "../contracts";

const id = z.uuid().toLowerCase();
export const maxPositionCount = 200;
const text = (length: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(length)
    .refine((value) => !/\p{Cc}/u.test(value));
const version = z.number().int().min(1).max(2147483646);
const header = { requestId: id, stocktakeId: id, expectedVersion: version };

export const stocktakeCommand = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("startCount"), requestId: id, locationId: id, note: text(200) }),
  z.strictObject({
    type: z.literal("recordCounts"),
    ...header,
    counts: z
      .array(
        z.strictObject({
          lineId: id,
          countedQuantity: z.number().int().min(0).max(1_000_000_000),
          reason: text(500).nullable(),
        }),
      )
      .min(1)
      .max(maxPositionCount),
  }),
  z.strictObject({ type: z.literal("reconcileCount"), ...header }),
  z.strictObject({ type: z.literal("cancelCount"), ...header, reason: text(500) }),
  z.strictObject({
    type: z.literal("captureValuation"),
    requestId: id,
    siteId: id,
    label: text(200),
  }),
]);

export const stocktakeQuery = z.strictObject({
  siteId: id.optional(),
  stocktakeId: id.optional(),
  valuationId: id.optional(),
});

export type StocktakeCommand = z.infer<typeof stocktakeCommand>;
export type CountCommand = Exclude<StocktakeCommand, { type: "captureValuation" }>;
export type ValuationCommand = Extract<StocktakeCommand, { type: "captureValuation" }>;
export type StocktakeQuery = z.infer<typeof stocktakeQuery>;
type WithoutRequest<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type StocktakeIntent = WithoutRequest<StocktakeCommand>;
export type StocktakeError = "unavailable" | "invalid" | "conflict" | "stale" | "limit";
export type StocktakeCommandResult =
  | { ok: true; id: string }
  | { ok: false; error: StocktakeError };

export type StocktakeSummary = {
  id: string;
  locationId: string;
  locationName: string;
  note: string;
  status: "draft" | "reconciled" | "cancelled";
  version: number;
  createdAt: string;
  closedAt: string | null;
};
export type StocktakeLine = {
  id: string;
  positionId: string;
  itemId: string;
  code: string;
  name: string;
  revision: string;
  lot: string | null;
  serial: string | null;
  expectedOnHand: number;
  reserved: number;
  countedQuantity: number | null;
  reason: string | null;
  countedAt: string | null;
  countedBy: string | null;
  correctionEventId: string | null;
};
export type StocktakeDetail = StocktakeSummary & { lines: StocktakeLine[] };

export type ValuationSummary = {
  id: string;
  label: string;
  currency: string;
  capturedAt: string;
  positions: number;
  quantity: number;
  reserved: number;
  unvaluedQuantity: number;
  totalValue: string;
};
export type ValuationLine = {
  id: string;
  positionId: string;
  itemId: string;
  locationId: string;
  locationName: string;
  code: string;
  name: string;
  revision: string;
  stockUnit: CatalogUnit;
  quantity: number;
  reserved: number;
  stockState: WarehouseStockState;
  lot: string | null;
  serial: string | null;
  source: "override" | "purchase_receipt" | "unvalued";
  basisAmount: string | null;
  basisPackQuantity: number | null;
  value: string | null;
};
export type ValuationDetail = ValuationSummary & { lines: ValuationLine[] };

export type StocktakeSite = {
  id: string;
  code: string;
  name: string;
  archived: boolean;
  canReadCounts: boolean;
  canCount: boolean;
  canReadValues: boolean;
  canCaptureValues: boolean;
};
export type StocktakeWorkspace = {
  sites: StocktakeSite[];
  selectedSiteId: string | null;
  locations: { id: string; code: string; name: string }[];
  stocktakes: StocktakeSummary[];
  stocktake: StocktakeDetail | null;
  valuationAccess?: { valuations: ValuationSummary[]; valuation: ValuationDetail | null };
};
export type StocktakeResult =
  | { ok: true; value: StocktakeWorkspace }
  | { ok: false; error: StocktakeError };
