import { z } from "zod";
import type { InventoryStockKind } from "../../schema";
import type { WarehouseStockEventKind, WarehouseStockState } from "../schema";

const id = z.uuid().toLowerCase();
const search = z
  .string()
  .trim()
  .max(160)
  .refine((value) => !value.includes("\0"));
const date = z.iso.date().refine((value) => !value.startsWith("0000"));
const timestamp = z.iso.datetime().refine((value) => !value.startsWith("0000"));
const source = z.enum(["event", "movement"]);
const status = z.enum(["draft", "in_transit", "received", "cancelled"]);
const cursor = z.strictObject({ id, createdAt: timestamp });
const movementCursor = cursor.extend({ source });
const filters = {
  search: search.optional(),
  itemId: id.optional(),
  siteId: id.optional(),
  locationId: id.optional(),
  limit: z.number().int().positive().max(100).optional(),
};

export const warehouseMovementHistoryQuery = z.strictObject({
  ...filters,
  movementId: id.optional(),
  kind: z
    .string()
    .regex(/^[a-z][a-z-]{0,31}$/)
    .optional(),
  from: date.optional(),
  to: date.optional(),
  cursor: movementCursor.optional(),
});

export const warehouseTransfersQuery = z.strictObject({
  ...filters,
  status: status.optional(),
  cursor: cursor.optional(),
});

export const warehouseInstallationsQuery = z.strictObject({ assemblyPositionId: id });

export type WarehouseMovementHistoryQuery = z.infer<typeof warehouseMovementHistoryQuery>;
export type WarehouseTransfersQuery = z.infer<typeof warehouseTransfersQuery>;
export type WarehouseInstallationsQuery = z.infer<typeof warehouseInstallationsQuery>;
export type WarehouseMovementCursor = z.infer<typeof movementCursor>;
export type WarehouseTransferCursor = z.infer<typeof cursor>;
export type WarehouseTransferStatus = z.infer<typeof status>;

export type WarehouseMovementRow = {
  id: string;
  source: z.infer<typeof source>;
  kind: WarehouseStockEventKind | InventoryStockKind;
  createdAt: string;
  itemId: string;
  code: string;
  name: string;
  revision: string;
  siteId: string | null;
  siteName: string | null;
  locationId: string | null;
  locationName: string | null;
  positionId: string | null;
  lot: string | null;
  serial: string | null;
  actorName: string | null;
  onHandDelta: number;
  reservedDelta: number;
  incomingDelta: number;
  affectedQuantity: number | null;
  previousState: WarehouseStockState | null;
  state: WarehouseStockState | null;
  previousOnHand: number | null;
  reason: string | null;
  orderId: string | null;
  incomingId: string | null;
  transferId: string | null;
  transferLineId: string | null;
  structureOperationId: string | null;
  sourcePositionId: string | null;
  reversesEventId: string | null;
  canReverse: boolean;
};

export interface WarehouseTransferLineRow {
  id: string;
  itemId: string;
  code: string;
  name: string;
  revision: string;
  sourcePositionId: string;
  lot: string | null;
  serial: string | null;
  quantity: number;
  received: number;
}

export type WarehouseTransferRow = {
  id: string;
  sourceSiteId: string;
  sourceSiteName: string;
  sourceLocationId: string;
  sourceLocationName: string;
  destinationSiteId: string;
  destinationSiteName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  status: WarehouseTransferStatus;
  version: number;
  reason: string;
  actorName: string | null;
  createdAt: string;
  updatedAt: string;
  lines: WarehouseTransferLineRow[];
  canManage: boolean;
};

export type WarehouseOperationsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "unavailable" };

export type WarehouseMovementHistoryResult = WarehouseOperationsResult<{
  rows: WarehouseMovementRow[];
  nextCursor: WarehouseMovementCursor | null;
}>;

export type WarehouseTransfersResult = WarehouseOperationsResult<{
  rows: WarehouseTransferRow[];
  nextCursor: WarehouseTransferCursor | null;
}>;

export type WarehouseInstallationRow = {
  id: string;
  componentItemId: string;
  componentCode: string;
  componentName: string;
  componentRevision: string;
  lot: string | null;
  serial: string | null;
  expiryDate: string | null;
  quantity: number;
  installedAt: string;
};

export type WarehouseInstallationsResult = WarehouseOperationsResult<{
  rows: WarehouseInstallationRow[];
  canManage: boolean;
  canDisassemble: boolean;
}>;
