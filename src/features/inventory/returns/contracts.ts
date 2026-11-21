import { z } from "zod";
import type { Result } from "@/types/result";

const id = z.uuid().toLowerCase();
const quantity = z.number().int().min(1).max(1_000_000);
const version = z.number().int().positive();
const reference = z.string().trim().min(1).max(80);
const reason = z.string().trim().min(1).max(400);
const note = z.string().trim().min(1).max(1000).nullable();
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/u);
const existing = { caseId: id, version, requestId: id };
export const returnConditions = ["unopened", "used", "damaged", "unknown"] as const;
export const returnDispositions = ["restock", "repair", "scrap"] as const;
export const returnCommercialKinds = ["refund", "replacement", "none"] as const;
export type ReturnCondition = (typeof returnConditions)[number];
export type ReturnDispositionKind = (typeof returnDispositions)[number];
export type ReturnCommercialKind = (typeof returnCommercialKinds)[number];

export const returnCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("saveDraft"),
    caseId: id.nullable(),
    version: version.nullable(),
    requestId: id,
    shipmentId: id,
    siteId: id,
    reference,
    note,
    charges: z
      .array(z.strictObject({ label: z.string().trim().min(1).max(120), amount }))
      .max(20)
      .refine(
        (charges) =>
          new Set(charges.map(({ label }) => label.toLowerCase())).size === charges.length,
      ),
    lines: z
      .array(z.strictObject({ shipmentLineId: id, quantity, reason }))
      .min(1)
      .max(200)
      .refine(
        (lines) => new Set(lines.map(({ shipmentLineId }) => shipmentLineId)).size === lines.length,
      ),
  }),
  z.strictObject({ type: z.literal("issue"), ...existing }),
  z.strictObject({ type: z.literal("hold"), ...existing, reason }),
  z.strictObject({ type: z.literal("resume"), ...existing, reason }),
  z.strictObject({ type: z.literal("cancel"), ...existing, reason }),
  z.strictObject({ type: z.literal("complete"), ...existing }),
  z.strictObject({ type: z.literal("duplicate"), ...existing, reference }),
  z.strictObject({
    type: z.literal("receive"),
    ...existing,
    lineId: id,
    locationId: id,
    quantity,
    serial: z.string().trim().min(1).max(120).nullable(),
    condition: z.enum(returnConditions),
    note,
  }),
  z.strictObject({
    type: z.literal("disposition"),
    ...existing,
    receiptId: id,
    kind: z.enum(returnDispositions),
    reason,
  }),
  z.strictObject({
    type: z.literal("commercial"),
    ...existing,
    receiptId: id,
    kind: z.enum(returnCommercialKinds),
    amount: amount.nullable(),
    reference: reference.nullable(),
    reason,
  }),
]);

export type ReturnCommand = z.infer<typeof returnCommand>;
export type ReturnError = "invalid" | "unavailable" | "state" | "stock" | "stale" | "conflict";
export type ReturnEffect = { ok: true; id: string } | { ok: false; error: ReturnError };
export type ReturnStatus = "draft" | "issued" | "onHold" | "completed" | "cancelled";
export type ReturnPhysicalStatus = "quarantine" | "repair" | "restocked" | "scrapped";
export const returnsQuery = z.strictObject({
  siteId: id.optional(),
  caseId: id.optional(),
  shipmentId: id.optional(),
});
export type ReturnsQuery = z.infer<typeof returnsQuery>;
export type ReturnCharge = { label: string; amount: string };
export type ReturnablePart = {
  id: string;
  code: string;
  name: string;
  revision: string;
  lot: string | null;
  serial: string | null;
  quantity: number;
  eligible: number;
  unitPrice: string | null;
};
export type ReturnSource = {
  id: string;
  reference: string;
  orderId: string;
  orderReference: string;
  dealName: string | null;
  customerName: string | null;
  currency: string | null;
  lines: ReturnablePart[];
  canCreate: boolean;
};
export type ReturnSummary = {
  id: string;
  shipmentId: string;
  shipmentReference: string;
  siteId: string;
  reference: string;
  status: ReturnStatus;
  quantity: number;
  received: number;
  createdAt: string;
};
export type ReturnReceiptView = {
  id: string;
  positionId: string;
  location: string;
  quantity: number;
  condition: ReturnCondition;
  note: string | null;
  receivedAt: string;
  eventId: string;
  physical: ReturnPhysicalStatus;
  commercial: {
    kind: ReturnCommercialKind;
    amount: string | null;
    reference: string | null;
    reason: string;
  } | null;
};
export type ReturnLineView = {
  id: string;
  shipmentLineId: string;
  code: string;
  name: string;
  revision: string;
  lot: string | null;
  serial: string | null;
  quantity: number;
  received: number;
  reason: string;
  receipts: ReturnReceiptView[];
};
export type ReturnDetail = ReturnSummary & {
  version: number;
  canEdit: boolean;
  canReceive: boolean;
  canDispose: boolean;
  canCommercial: boolean;
  canDuplicate: boolean;
  canCancel: boolean;
  canComplete?: boolean;
  note: string | null;
  charges: ReturnCharge[] | null;
  currency: string | null;
  lines: ReturnLineView[];
  history: { id: string; type: ReturnCommand["type"]; at: string; reason: string | null }[];
};
export type ReturnsWorkspace = {
  sites: { id: string; code: string; name: string; archived: boolean }[];
  bins: { id: string; siteId: string; code: string; name: string }[];
  source: ReturnSource | null;
  cases: ReturnSummary[];
  detail: ReturnDetail | null;
};
export type ReturnsWorkspaceResult = Result<ReturnsWorkspace, ReturnError>;
