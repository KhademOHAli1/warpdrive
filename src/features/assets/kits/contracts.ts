import { z } from "zod";
import type { AssetsWorkspace } from "../contracts";
import { custodyConditions } from "../custody/contracts";

const id = z.uuid().toLowerCase();
const version = z.number().int().positive();
const quantity = z.number().int().min(0).max(1_000_000);
function text(limit: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(limit)
    .refine((value) => !value.includes("\u0000"));
}
const note = text(400).nullable();
const command = { siteId: id, requestId: id };
const existing = { ...command, kitId: id, version };
export const kitMemberModes = [
  "individual",
  "model",
  "returnable_pool",
  "consumable_pool",
] as const;

const member = z.strictObject({
  mode: z.enum(kitMemberModes),
  assetId: id,
  modelId: id.nullable(),
  quantity: quantity.refine((value) => value > 0),
  sourceLocationId: id.nullable(),
});
const replacements = z
  .array(z.strictObject({ lineId: id, assetId: id }))
  .max(60)
  .refine((lines) => new Set(lines.map(({ lineId }) => lineId)).size === lines.length);
const settlements = z
  .array(
    z
      .strictObject({ lineId: id, returned: quantity, consumed: quantity })
      .refine((line) => line.returned + line.consumed > 0),
  )
  .min(1)
  .max(60)
  .refine((lines) => new Set(lines.map(({ lineId }) => lineId)).size === lines.length);

export const kitCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("saveKit"),
    ...command,
    kitId: id.nullable(),
    version: version.nullable(),
    code: text(80),
    name: text(120),
    locationId: id,
    lines: z.array(member).max(60),
    note,
  }),
  z.strictObject({ type: z.literal("moveKit"), ...existing, locationId: id, note }),
  z.strictObject({
    type: z.literal("checkoutKit"),
    ...existing,
    custodianId: id,
    replacements,
    note,
  }),
  z.strictObject({
    type: z.literal("returnKit"),
    ...existing,
    checkoutId: id,
    lines: settlements,
    condition: z.enum(custodyConditions),
    note,
  }),
]);

export type KitCommand = z.infer<typeof kitCommand>;
type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type KitIntent = WithoutRequestId<KitCommand>;
export type KitMemberInput = z.infer<typeof member>;
export type KitMember = KitMemberInput & { id: string; packedQuantity: number };

export type Kit = {
  id: string;
  siteId: string;
  code: string;
  name: string;
  locationId: string;
  version: number;
  definitionVersion: number;
  lines: KitMember[];
};

export type KitCheckoutLine = {
  id: string;
  mode: KitMemberInput["mode"];
  requestedAssetId: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  serial: string | null;
  modelId: string | null;
  sourceLocationId: string;
  quantity: number;
  returned: number;
  consumed: number;
};

export type KitCheckout = {
  id: string;
  siteId: string;
  kitId: string;
  kitCode: string;
  kitName: string;
  definitionVersion: number;
  locationId: string;
  custodianId: string;
  custodianName: string;
  actor: string;
  at: string;
  closedAt: string | null;
  note: string | null;
  lines: KitCheckoutLine[];
};

export type KitReturn = {
  id: string;
  siteId: string;
  kitId: string;
  checkoutId: string;
  actor: string;
  at: string;
  condition: (typeof custodyConditions)[number];
  note: string | null;
  lines: { lineId: string; returned: number; consumed: number }[];
};

export type KitActivity = {
  id: string;
  siteId: string;
  kitId: string;
  kind: "created" | "edited" | "moved" | "checked_out" | "returned";
  version: number;
  actor: string;
  at: string;
  note: string | null;
  fromLocationId: string | null;
  locationId: string;
};

export type KitWorkspace = {
  records: Kit[];
  checkouts: KitCheckout[];
  returns: KitReturn[];
  history: KitActivity[];
};

export type KitError =
  | "invalid"
  | "unavailable"
  | "stale"
  | "conflict"
  | "held"
  | "ineligible"
  | "quantity";
export type KitResult =
  | { ok: true; value: AssetsWorkspace & { kits: KitWorkspace }; kitId: string }
  | { ok: false; error: KitError };

export function emptyKitWorkspace(): KitWorkspace {
  return { records: [], checkouts: [], returns: [], history: [] };
}

export function validKitIntent(intent: KitIntent): boolean {
  return kitCommand.safeParse({
    ...intent,
    requestId: "00000000-0000-4000-8000-000000000000",
  }).success;
}
