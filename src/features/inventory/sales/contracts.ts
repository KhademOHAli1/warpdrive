import { z } from "zod";
import { currencyCode } from "@/features/currencies/currencySchema";
import type { Result } from "@/types/result";
import type { CatalogUnit } from "../catalog/contracts";

const id = z.uuid().toLowerCase();
const quantity = z.number().int().min(1).max(1_000_000);
const version = z.number().int().positive();
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/u);
const reference = z.string().trim().min(1).max(80);
const date = z.iso.date();
const change = { orderId: id, version, requestId: id };
const shipment = { ...change, shipmentId: id };
export const salesCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("saveDraft"),
    orderId: id.nullable(),
    version: version.nullable(),
    requestId: id,
    dealId: id,
    siteId: id,
    reference,
    dueDate: date.nullable(),
    recipient: z.string().trim().min(1).max(180),
    address: z.string().trim().min(1).max(1000),
    currency: currencyCode,
    charges: z
      .array(z.strictObject({ label: z.string().trim().min(1).max(120), amount }))
      .max(20)
      .refine(
        (charges) =>
          new Set(charges.map(({ label }) => label.toLowerCase())).size === charges.length,
      ),
    lines: z
      .array(
        z.strictObject({
          itemId: id,
          quantity,
          unitPrice: amount,
          note: z.string().trim().min(1).max(240).nullable(),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.strictObject({ type: z.literal("issueOrder"), ...change }),
  z.strictObject({
    type: z.literal("cancelOrder"),
    ...change,
    reason: z.string().trim().min(1).max(400),
  }),
  z.strictObject({ type: z.literal("reschedule"), ...change, dueDate: date.nullable() }),
  z.strictObject({ type: z.literal("allocate"), ...change, lineId: id, positionId: id, quantity }),
  z.strictObject({ type: z.literal("autoAllocate"), ...change, lineId: id.optional() }),
  z.strictObject({ type: z.literal("deallocate"), ...change, allocationId: id, quantity }),
  z.strictObject({
    type: z.literal("createShipment"),
    ...change,
    reference,
    lines: z
      .array(z.strictObject({ allocationId: id, quantity }))
      .min(1)
      .max(250),
  }),
  z.strictObject({
    type: z.literal("checkShipmentLine"),
    ...shipment,
    shipmentLineId: id,
    checked: z.boolean(),
    scan: z.string().trim().min(1).max(120).optional(),
  }),
  z.strictObject({
    type: z.literal("postShipment"),
    ...shipment,
    carrier: z.string().trim().min(1).max(120),
    tracking: z.string().trim().min(1).max(160).nullable(),
    shippedOn: date,
  }),
  z.strictObject({ type: z.literal("cancelShipment"), ...shipment }),
]);
export type SalesCommand = z.infer<typeof salesCommand>;
export const salesQuery = z.strictObject({
  siteId: id.optional(),
  dealId: id.optional(),
  orderId: id.optional(),
});
export type SalesQuery = z.infer<typeof salesQuery>;
export type SalesError = "invalid" | "unavailable" | "state" | "stock" | "stale" | "conflict";
export type SalesEffect =
  | { ok: true; id: string; shipmentId?: string }
  | { ok: false; error: SalesError };

export type SalesOrderStatus = "draft" | "issued" | "shipped" | "cancelled";
export type SalesShipmentStatus = "draft" | "shipped" | "cancelled";
export type SalesCharge = { label: string; amount: string };
export type SalesPart = {
  id: string;
  code: string;
  name: string;
  revision: string;
  unit: CatalogUnit;
};
export type SalesOrderSummary = {
  id: string;
  siteId: string;
  dealId: string | null;
  reference: string;
  status: SalesOrderStatus;
  dueDate: string | null;
  createdAt: string;
  ordered: number;
  allocated: number;
  shipped: number;
  backordered: number;
  customerName: string | null;
};
export type SalesPosition = {
  id: string;
  location: string;
  lot: string | null;
  serial: string | null;
  available: number;
};
export type SalesOrderLine = {
  id: string;
  itemId: string;
  code: string;
  name: string;
  revision: string;
  unit: CatalogUnit;
  quantity: number;
  shipped: number;
  allocated: number;
  note: string | null;
  unitPrice: string | null;
  allocations: {
    id: string;
    quantity: number;
    committed: number;
    positionId: string;
    location: string;
    lot: string | null;
    serial: string | null;
  }[];
  positions: SalesPosition[];
};
export type SalesShipment = {
  id: string;
  reference: string;
  status: SalesShipmentStatus;
  carrier: string | null;
  tracking: string | null;
  shippedOn: string | null;
  lines: {
    id: string;
    lineId: string;
    quantity: number;
    checked: boolean;
    lot: string | null;
    serial: string | null;
    location: string;
    eventId: string | null;
  }[];
};
export type SalesOrderDetail = SalesOrderSummary & {
  version: number;
  canEdit: boolean;
  canFulfill: boolean;
  canCancel?: boolean;
  delivery: { recipient: string; address: string } | null;
  commercial: { dealName: string; currency: string; charges: SalesCharge[] } | null;
  lines: SalesOrderLine[];
  shipments: SalesShipment[];
};
export type SalesWorkspace = {
  today: string;
  sites: { id: string; code: string; name: string; canFulfill: boolean; archived?: boolean }[];
  deal: {
    id: string;
    name: string;
    currency: string;
    customerName: string | null;
    address: string | null;
    canOrder: boolean;
  } | null;
  parts: SalesPart[];
  orders: SalesOrderSummary[];
  detail: SalesOrderDetail | null;
};
export type SalesWorkspaceResult = Result<SalesWorkspace, SalesError>;
