import { z } from "zod";
import type { Booking, BookingError, BookingKind } from "../contracts";

const id = z.uuid().toLowerCase();
const quantity = z.number().int().min(1).max(1_000_000);
const count = z.number().int().min(0).max(1_000_000);
const lineKey = z.string().min(1).max(140);
const note = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.includes("\u0000"));
const distinct = <T>(rows: T[], key: (row: T) => string) =>
  new Set(rows.map(key)).size === rows.length;
const envelope = {
  bookingId: id,
  bookingVersion: z.number().int().positive(),
  handoverVersion: z.number().int().nonnegative(),
  requestId: id,
};

const pick = z.strictObject({ lineKey, targetId: id, quantity });
const returnItem = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("equipment"),
    allocationId: id,
    locationId: id,
    quantity,
    condition: z.enum(["good", "worn", "damaged", "needs_inspection"]),
  }),
  z.strictObject({
    kind: z.literal("kit"),
    allocationId: id,
    members: z
      .array(
        z
          .strictObject({ id, returned: count, consumed: count })
          .refine(({ returned, consumed }) => returned + consumed > 0),
      )
      .min(1)
      .max(60)
      .refine((rows) => distinct(rows, ({ id }) => id)),
  }),
]);

export const bookingHandoverCommand = z.discriminatedUnion("type", [
  z.strictObject({
    ...envelope,
    type: z.literal("pickup"),
    custodianId: id,
    items: z
      .array(pick)
      .min(1)
      .max(100)
      .refine((rows) => distinct(rows, ({ lineKey, targetId }) => `${lineKey}:${targetId}`)),
    keepPickupOpen: z.boolean(),
    note: note.nullable(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("checkIn"),
    items: z
      .array(returnItem)
      .min(1)
      .max(100)
      .refine((rows) => distinct(rows, ({ allocationId }) => allocationId)),
    note: note.nullable(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("amendDue"),
    dueAt: z.iso.datetime().transform((value) => new Date(value).toISOString()),
    reason: note,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("closePickup"),
    reason: note,
  }),
]);

type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;

export type BookingHandoverCommand = z.infer<typeof bookingHandoverCommand>;
export type BookingHandoverIntent = WithoutRequestId<BookingHandoverCommand>;
export type BookingPickupItem = z.infer<typeof pick>;
export type BookingCheckInItem = z.infer<typeof returnItem>;

export type BookingHandoverStatus = "ready" | "ongoing" | "overdue" | "completed" | "expired";
type EquipmentKind = Exclude<BookingKind, "model">;
type Reference = { id: string; name: string };
type Equipment = { targetId: string; name: string; code: string; serial: string | null };

export type BookingPickupOption = Equipment & { available: number };
export type BookingPickupLine = {
  key: string;
  kind: BookingKind;
  name: string;
  code: string;
  bin: string | null;
  quantity: number;
  picked: number;
  options: BookingPickupOption[];
};

export type BookingKitMember = {
  id: string;
  targetId: string;
  name: string;
  code: string;
  serial: string | null;
  outstanding: number;
  consumable: boolean;
};

export type BookingHandoverAllocation = Equipment & {
  id: string;
  lineKey: string;
  kind: EquipmentKind;
  sourceLocationId: string | null;
  sourceBin: string | null;
  issued: number;
  outstanding: number;
  members: BookingKitMember[];
};

type ReceiptLine = Equipment & {
  kitId?: string;
  kitCode?: string;
  sourceBin: string | null;
  destinationBin: string | null;
  quantity: number;
  disposition: "issued" | "returned" | "consumed" | "damaged" | "needs_inspection" | "uncollected";
};

export type BookingHandoverReceipt = {
  id: string;
  kind: "pickup" | "checkIn" | "amendDue" | "closePickup";
  at: string;
  actor: string;
  custodianName: string | null;
  bookingTitle: string;
  siteName: string;
  dueAt: string;
  previousDueAt: string | null;
  note: string | null;
  items: ReceiptLine[];
  remaining: ReceiptLine[];
};

export type BookingHandoverNotice = {
  id: string;
  kind: "overdue" | "expired";
  dueAt: string;
  at: string;
};

export type BookingHandoverView = {
  bookingId: string;
  bookingVersion: number;
  version: number;
  status: BookingHandoverStatus;
  dueAt: string;
  pickupClosed: boolean;
  canOperate: boolean;
  custodian: Reference | null;
  custodians: Reference[];
  locations: Reference[];
  lines: BookingPickupLine[];
  allocations: BookingHandoverAllocation[];
  receipts: BookingHandoverReceipt[];
  notices: BookingHandoverNotice[];
};

type Failure = { ok: false; error: BookingError };

export type BookingHandoverRead = { ok: true; value: BookingHandoverView } | Failure;
export type BookingHandoverWrite =
  | { ok: true; value: BookingHandoverView; booking: Booking }
  | Failure;
export type BookingHandoverLookup = { ok: true; id: string; kind: "asset" | "kit" } | Failure;

export type BookingHandoverAccess = {
  read: (bookingId: string) => Promise<BookingHandoverRead>;
  submit: (input: BookingHandoverCommand) => Promise<BookingHandoverWrite>;
  lookup: (bookingId: string, code: string) => Promise<BookingHandoverLookup>;
};
