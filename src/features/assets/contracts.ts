import { z } from "zod";
import type { CustodyWorkspace } from "./custody/contracts";
import type { KitWorkspace } from "./kits/contracts";

export const assetTrackingMethods = ["individual", "returnable_pool", "consumable_pool"] as const;
export const assetFieldTypes = ["text", "number", "date", "boolean", "choice", "link"] as const;
export const assetEventKinds = [
  "created",
  "updated",
  "moved",
  "restocked",
  "consumed",
  "adjusted",
  "archived",
  "reinstated",
  "note",
] as const;

const id = z.uuid().toLowerCase();
const version = z.number().int().positive();
function text(maximum: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((input) => !input.includes("\u0000"));
}
const code = text(80);
const name = text(120);
const description = text(1_000).nullable();
const reason = text(400);
const quantity = z.number().int().min(0).max(1_000_000);
const assetValue = z.union([text(1_000), z.number(), z.boolean(), z.null()]);
const fieldValues = z.record(id, assetValue).refine((values) => Object.keys(values).length <= 32);
const tags = z.array(text(40)).max(20);

const field = z.strictObject({
  id,
  label: text(80),
  type: z.enum(assetFieldTypes),
  options: z.array(text(80)).max(30),
  required: z.boolean(),
  defaultValue: assetValue,
});

const identity = { siteId: id, requestId: id };
const existing = { assetId: id, version, requestId: id };
const metadata = { code, name, description, categoryId: id.nullable(), tags, fieldValues };
const individual = { serial: code.nullable(), modelId: id.nullable() };

export const assetCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("create"),
    ...identity,
    ...metadata,
    ...individual,
    tracking: z.enum(assetTrackingMethods),
    locationId: id.nullable(),
    openingQuantity: quantity,
  }),
  z.strictObject({
    type: z.literal("createFleet"),
    ...identity,
    modelId: id,
    locationId: id.nullable(),
    units: z
      .array(z.strictObject({ code, serial: code.nullable() }))
      .min(1)
      .max(50),
  }),
  z.strictObject({ type: z.literal("update"), ...existing, ...metadata, ...individual }),
  z.strictObject({ type: z.literal("move"), ...existing, locationId: id.nullable(), reason }),
  z.strictObject({
    type: z.literal("changePool"),
    ...existing,
    operation: z.enum(["restock", "consume", "adjust", "move"]),
    locationId: id,
    toLocationId: id.nullable(),
    quantity,
    reason,
  }),
  z.strictObject({ type: z.literal("setArchive"), ...existing, archived: z.boolean(), reason }),
  z.strictObject({ type: z.literal("note"), ...existing, reason }),
  z.strictObject({
    type: z.literal("saveCategory"),
    ...identity,
    categoryId: id.nullable(),
    version: version.nullable(),
    name,
    fields: z.array(field).max(32),
  }),
  z.strictObject({
    type: z.literal("saveModel"),
    ...identity,
    modelId: id.nullable(),
    version: version.nullable(),
    ...metadata,
  }),
]);

type WithRequestId = { requestId: string };
type Intent<T> = T extends WithRequestId ? Omit<T, "requestId"> : never;
export type AssetCommand = z.infer<typeof assetCommand>;
export type AssetIntent = Intent<AssetCommand>;
export type AssetField = z.infer<typeof field>;
export type AssetValue = z.infer<typeof assetValue>;
export type AssetTracking = (typeof assetTrackingMethods)[number];
export type AssetFieldType = (typeof assetFieldTypes)[number];
export type AssetEventKind = (typeof assetEventKinds)[number];

export type AssetSite = { id: string; code: string; name: string; canManage: boolean };
export type AssetLocation = {
  id: string;
  siteId: string;
  parentId: string | null;
  code: string;
  name: string;
  archived: boolean;
};
export type AssetCategory = {
  id: string;
  siteId: string;
  name: string;
  version: number;
  fields: AssetField[];
};
export type AssetModel = Pick<
  Extract<AssetCommand, { type: "saveModel" }>,
  keyof typeof metadata
> & {
  id: string;
  siteId: string;
  version: number;
};
export type AssetEvent = {
  id: string;
  kind: AssetEventKind;
  at: string;
  actor: string;
  reason: string | null;
  fromLocationId: string | null;
  locationId: string | null;
  quantity: number | null;
};
export type AssetBalance = { locationId: string; quantity: number };
export type AssetRecord = AssetModel & {
  archivedAt: string | null;
  events: AssetEvent[];
} & (
    | {
        tracking: "individual";
        serial: string | null;
        modelId: string | null;
        locationId: string | null;
      }
    | { tracking: "returnable_pool" | "consumable_pool"; balances: AssetBalance[] }
  );
export type AssetsWorkspace = {
  sites: AssetSite[];
  locations: AssetLocation[];
  categories: AssetCategory[];
  models: AssetModel[];
  records: AssetRecord[];
  custody?: CustodyWorkspace;
  kits?: KitWorkspace;
  mediaAvailable?: true;
  discoveryAvailable?: true;
  auditHistoryAvailable?: true;
};
export type AssetError = "unavailable" | "invalid" | "stale" | "conflict" | "stock" | "state";
export type AssetResult =
  | { ok: true; value: AssetsWorkspace; focusId: string | null }
  | { ok: false; error: AssetError };

export function validAssetIntent(intent: AssetIntent): boolean {
  return assetCommand.safeParse({ ...intent, requestId: "00000000-0000-4000-8000-000000000000" })
    .success;
}
