import { z } from "zod";
import type { AssetsWorkspace } from "../contracts";

const id = z.uuid().toLowerCase();
const version = z.number().int().positive();
const quantity = z.number().int().min(1).max(1_000_000);
function text(limit: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(limit)
    .refine((value) => !value.includes("\u0000"));
}

export const custodyConditions = ["good", "worn", "damaged", "needs_inspection"] as const;
export const custodyActions = ["assign", "transfer", "return"] as const;
const note = text(400);
const command = { siteId: id, requestId: id };
const handover = {
  locationId: id.nullable(),
  condition: z.enum(custodyConditions),
  note: note.nullable(),
};
const single = { ...command, ...handover, assetId: id, version, quantity };
const selected = z
  .array(z.strictObject({ assetId: id, version }))
  .min(1)
  .max(100)
  .refine((rows) => new Set(rows.map(({ assetId }) => assetId)).size === rows.length);

export const custodyCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("saveCustodian"),
    ...command,
    custodianId: id.nullable(),
    version: version.nullable(),
    staffId: id.nullable(),
    name: text(120).nullable(),
    active: z.boolean(),
  }),
  z.strictObject({ type: z.literal("noteCustodian"), ...command, custodianId: id, note }),
  z.strictObject({ type: z.literal("assign"), ...single, custodianId: id }),
  z.strictObject({ type: z.literal("transfer"), ...single, holdingId: id, custodianId: id }),
  z.strictObject({ type: z.literal("return"), ...single, holdingId: id }),
  z.strictObject({
    type: z.literal("bulkAssign"),
    ...command,
    ...handover,
    assets: selected,
    custodianId: id,
  }),
  z.strictObject({ type: z.literal("bulkReturn"), ...command, ...handover, assets: selected }),
]);

export type CustodyCommand = z.infer<typeof custodyCommand>;
type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type CustodyIntent = WithoutRequestId<CustodyCommand>;
export type CustodyCondition = (typeof custodyConditions)[number];
export type CustodyAction = (typeof custodyActions)[number];

export type Custodian = {
  id: string;
  siteId: string;
  name: string;
  kind: "staff" | "non_login";
  staffId: string | null;
  active: boolean;
  version: number;
};

export type CustodyHolding = {
  id: string;
  siteId: string;
  assetId: string;
  custodianId: string;
  custodianName: string;
  quantity: number;
  sourceLocationId: string | null;
  locationId: string | null;
  condition: CustodyCondition;
  assignedAt: string;
};

export type CustodyEvent = {
  id: string;
  siteId: string;
  assetId: string;
  version: number;
  action: CustodyAction;
  holdingId: string;
  destinationHoldingId: string | null;
  fromCustodianId: string | null;
  fromCustodianName: string | null;
  toCustodianId: string | null;
  toCustodianName: string | null;
  quantity: number;
  sourceLocationId: string | null;
  locationId: string | null;
  condition: CustodyCondition;
  note: string | null;
  actor: string;
  at: string;
};

export type CustodianNote = {
  id: string;
  siteId: string;
  custodianId: string;
  note: string;
  actor: string;
  at: string;
};

export type CustodyWorkspace = {
  custodians: Custodian[];
  staff: { id: string; name: string }[];
  holdings: CustodyHolding[];
  events: CustodyEvent[];
  notes: CustodianNote[];
};

export type CustodyError =
  | "invalid"
  | "unavailable"
  | "stale"
  | "conflict"
  | "held"
  | "ineligible"
  | "quantity";
export type CustodyOutcome =
  | { assetId: string; ok: true }
  | { assetId: string; ok: false; error: CustodyError };
export type CustodyResult =
  | { ok: true; value: AssetsWorkspace & { custody: CustodyWorkspace }; outcomes: CustodyOutcome[] }
  | { ok: false; error: CustodyError };

export function emptyCustodyWorkspace(): CustodyWorkspace {
  return { custodians: [], staff: [], holdings: [], events: [], notes: [] };
}

export function validCustodyIntent(intent: CustodyIntent): boolean {
  return custodyCommand.safeParse({
    ...intent,
    requestId: "00000000-0000-4000-8000-000000000000",
  }).success;
}
