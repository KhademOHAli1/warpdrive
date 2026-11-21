import { z } from "zod";

const id = z.uuid().toLowerCase();
const quantity = z.number().int().positive().max(1_000_000);
const stockCount = z.number().int().min(0).max(1_000_000_000);
const reason = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.includes("\0"));

const transferChange = { requestId: id, id, version: z.number().int().positive(), reason };
const sourceLine = z.strictObject({ positionId: id, quantity });
const receiveLine = z.strictObject({ lineId: id, quantity });

export const warehouseOperationsCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("createTransfer"),
    requestId: id,
    sourceLocationId: id,
    destinationLocationId: id,
    reason,
    lines: z.array(sourceLine).min(1).max(20),
  }),
  z.strictObject({ type: z.literal("dispatchTransfer"), ...transferChange }),
  z.strictObject({
    type: z.literal("receiveTransfer"),
    ...transferChange,
    lines: z.array(receiveLine).min(1).max(20),
  }),
  z.strictObject({ type: z.literal("cancelTransfer"), ...transferChange }),
  z.strictObject({
    type: z.literal("correctStock"),
    requestId: id,
    positionId: id,
    locationId: id,
    expectedOnHand: stockCount,
    countedQuantity: stockCount,
    reason,
  }),
  z.strictObject({
    type: z.literal("reverseCorrection"),
    requestId: id,
    eventId: id,
    expectedOnHand: stockCount,
    reason,
  }),
]);

export type WarehouseOperationsCommand = z.infer<typeof warehouseOperationsCommand>;
type WithoutRequest<C> = C extends { requestId: string } ? Omit<C, "requestId"> : never;
export type WarehouseOperationsIntent = WithoutRequest<WarehouseOperationsCommand>;

export type WarehouseOperationsError =
  | "unavailable"
  | "invalid"
  | "conflict"
  | "insufficientStock"
  | "incompatibleLocation"
  | "stale"
  | "alreadyReversed";

export type WarehouseOperationsResult =
  | { ok: true; value: { id: string } }
  | { ok: false; error: WarehouseOperationsError };
