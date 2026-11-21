import { z } from "zod";
import type { CatalogUnit } from "../catalog/contracts";

const id = z.uuid().toLowerCase();
const version = z.number().int().min(1).max(2147483646);
const count = z.number().int().min(1).max(1_000_000);
const date = z.iso
  .date()
  .refine((value) => !value.startsWith("0000"))
  .nullable();
const text = (limit: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(limit)
    .refine((value) => !/\p{Cc}/u.test(value));
const identity = text(80)
  .transform((value) => value.toUpperCase())
  .pipe(text(80))
  .nullable();
const header = { requestId: id, id, expectedVersion: version };
export const purchaseOrderStatuses = ["draft", "open", "partial", "received", "cancelled"] as const;
export const purchaseReceiptDispositions = ["accepted", "rejected"] as const;
const receiptLine = z.strictObject({
  lineId: id,
  quantity: count,
  lot: identity,
  serial: identity,
  expiryDate: date,
  disposition: z.enum(purchaseReceiptDispositions),
  reason: text(500).nullable(),
});

export const purchasingCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("saveDraft"),
    requestId: id,
    id: id.nullable(),
    expectedVersion: version.nullable(),
    siteId: id,
    locationId: id,
    supplierOrganizationId: id,
    reference: text(120),
    expectedDate: date,
    lines: z
      .array(z.strictObject({ offerId: id, packs: count }))
      .min(1)
      .max(20),
  }),
  z.strictObject({ type: z.literal("issue"), ...header }),
  z.strictObject({ type: z.literal("cancel"), ...header, reason: text(500) }),
  z.strictObject({
    type: z.literal("receive"),
    ...header,
    supplierSlip: text(120),
    lines: z.array(receiptLine).min(1).max(30),
  }),
]);
export const purchasingQuery = z.strictObject({ siteId: id.optional(), orderId: id.optional() });

export type PurchasingCommand = z.infer<typeof purchasingCommand>;
export type PurchasingQuery = z.infer<typeof purchasingQuery>;
type WithoutRequest<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type PurchasingIntent = WithoutRequest<PurchasingCommand>;
export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];
export type PurchaseReceiptDisposition = (typeof purchaseReceiptDispositions)[number];
export type PurchasingError =
  | "unavailable"
  | "invalid"
  | "conflict"
  | "stale"
  | "insufficientStock";
export type PurchasingCommandResult =
  | { ok: true; id: string }
  | { ok: false; error: PurchasingError };

export type PurchasingSite = {
  id: string;
  code: string;
  name: string;
  archived: boolean;
  canBuy: boolean;
  canReceive: boolean;
  canReadCosts: boolean;
};
export type PurchasingLocation = { id: string; name: string; code: string };
export type PurchaseOffer = {
  id: string;
  itemId: string;
  version: number;
  supplierOrganizationId: string;
  supplierName: string;
  partNumber: string;
  partCode: string;
  partName: string;
  revision: string;
  packQuantity: number;
  stockUnit: CatalogUnit;
  trackable: boolean;
};
export type PurchaseOrderLine = {
  id: string;
  offerId: string;
  itemId: string;
  partNumber: string;
  partCode: string;
  partName: string;
  revision: string;
  packQuantity: number;
  stockUnit: CatalogUnit;
  packs: number;
  orderedUnits: number;
  receivedUnits: number;
  trackable: boolean;
  subcontracted?: true;
  subcontractBuildId?: string;
};
export type PurchaseReceiptLine = {
  id: string;
  lineId: string;
  quantity: number;
  lot: string | null;
  serial: string | null;
  expiryDate: string | null;
  disposition: PurchaseReceiptDisposition;
  reason: string | null;
  positionId: string | null;
  heldForRelease?: true;
};
export type PurchaseReceipt = {
  id: string;
  supplierSlip: string;
  postedAt: string;
  lines: PurchaseReceiptLine[];
};
export type PurchasePrice = { lineId: string; currency: string; amount: string; minPacks: number };
export type PurchaseOrder = {
  id: string;
  siteId: string;
  locationId: string;
  locationName: string;
  supplierOrganizationId: string;
  supplierName: string;
  reference: string;
  expectedDate: string | null;
  status: PurchaseOrderStatus;
  version: number;
  canEdit: boolean;
  canReceive: boolean;
  subcontractCancellationBlocked?: true;
  lines: PurchaseOrderLine[];
  receipts: PurchaseReceipt[];
  pricing?: PurchasePrice[];
};
export type PurchasingWorkspace = {
  sites: PurchasingSite[];
  selectedSiteId: string | null;
  selectedOrderId: string | null;
  locations: PurchasingLocation[];
  organizations: { id: string; name: string }[];
  offers: PurchaseOffer[];
  orders: PurchaseOrder[];
};
export type PurchasingResult =
  | { ok: true; value: PurchasingWorkspace }
  | { ok: false; error: PurchasingError };
