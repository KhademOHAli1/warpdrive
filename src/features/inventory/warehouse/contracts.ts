import { z } from "zod";

const id = z.uuid().toLowerCase();
const quantity = z.number().int().positive().max(1_000_000);
const date = z.iso
  .date()
  .refine((value) => !value.startsWith("0000"))
  .nullable();
const identity = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(80)
  .refine((value) => !value.includes("\0"))
  .nullable();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !value.includes("\0"));
const state = z.enum(["available", "hold", "quarantine"]);
const kind = z.enum(["storage", "structure", "external"]);

const positionFields = {
  requestId: id,
  itemId: id,
  locationId: id,
  quantity,
  lot: identity,
  serial: identity,
  expiryDate: date,
  state,
  ownerOrganizationId: id.nullable(),
};
export const warehouseCommand = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("receive"), ...positionFields, incomingId: id.nullable() }),
  z.strictObject({ type: z.literal("reconcile"), ...positionFields }),
  z.strictObject({ type: z.literal("saveLocationPolicy"), requestId: id, locationId: id, kind }),
  z.strictObject({
    type: z.literal("createIncoming"),
    requestId: id,
    itemId: id,
    locationId: id,
    quantity,
    expectedDate: date,
    reference: text(120).pipe(z.string().min(1)).nullable(),
    ownerOrganizationId: id.nullable(),
  }),
  z.strictObject({ type: z.literal("cancelIncoming"), requestId: id, id }),
  z.strictObject({ type: z.literal("setPositionState"), requestId: id, id, state, quantity }),
]);
export type WarehouseCommand = z.infer<typeof warehouseCommand>;
type WithoutRequest<C> = C extends { requestId: string } ? Omit<C, "requestId"> : never;
export type WarehouseIntent = WithoutRequest<WarehouseCommand>;

export const warehouseQuery = z.strictObject({
  itemId: id.optional(),
  siteId: id.optional(),
  locationId: id.optional(),
  search: text(160).optional(),
  showEmpty: z.boolean().optional(),
});
export type WarehouseQuery = z.infer<typeof warehouseQuery>;
export type WarehouseStockState = z.infer<typeof state>;
export type WarehouseLocationKind = z.infer<typeof kind>;
export type WarehouseSite = {
  id: string;
  code: string;
  name: string;
  archived: boolean;
  canManage: boolean;
};
export type WarehouseLocation = {
  id: string;
  siteId: string;
  parentId: string | null;
  code: string;
  name: string;
  archived: boolean;
  kind: WarehouseLocationKind;
};
export type WarehousePart = {
  id: string;
  code: string;
  sku: string;
  name: string;
  revision: string;
  kind: "component" | "product";
  trackable: boolean;
  canReceive: boolean;
};
export type WarehousePosition = {
  id: string;
  itemId: string;
  siteId: string;
  locationId: string;
  lot: string | null;
  serial: string | null;
  expiryDate: string | null;
  state: WarehouseStockState;
  ownerOrganizationId: string | null;
  owned: boolean;
  onHand: number;
  reserved: number;
  available: number;
};
export type WarehouseIncoming = {
  id: string;
  itemId: string;
  siteId: string;
  locationId: string;
  quantity: number;
  received: number;
  cancelled: boolean;
  expectedDate: string | null;
  reference: string | null;
  ownerOrganizationId: string | null;
  owned: boolean;
  purchaseOwned: boolean;
  purchaseOrderId: string | null;
};
export type WarehouseBalance = {
  itemId: string;
  siteId: string | null;
  locationId: string | null;
  onHand: number;
  reserved: number;
  incoming: number;
  available: number;
};
export type WarehouseWorkspace = {
  sites: WarehouseSite[];
  locations: WarehouseLocation[];
  parts: WarehousePart[];
  positions: WarehousePosition[];
  balances: WarehouseBalance[];
  incoming: WarehouseIncoming[];
  organizations: { id: string; name: string }[];
  canManageUnlocated: boolean;
  commissioningSiteIds?: string[];
};
export type WarehouseError =
  | "unavailable"
  | "invalid"
  | "conflict"
  | "duplicateSerial"
  | "insufficientStock"
  | "incompatibleLocation"
  | "planMismatch";

export type WarehouseResult =
  | { ok: true; value: WarehouseWorkspace; focusId?: string }
  | { ok: false; error: WarehouseError };
