import { z } from "zod";

const id = z.uuid().toLowerCase();
const title = z.string().trim().min(1).max(100);
export const assetTagTargetRef = z.strictObject({ kind: z.enum(["asset", "kit"]), id });
export type AssetTagTargetRef = z.infer<typeof assetTagTargetRef>;

export type AssetTagSite = { id: string; code: string; name: string; canManage: boolean };
export type AssetTagTarget = AssetTagTargetRef & {
  siteId: string;
  title: string;
  subtitle: string | null;
  href: string | null;
  canManage: boolean;
};
export type AssetTagBatch = {
  id: string;
  siteId: string;
  title: string;
  source: "printed" | "imported";
  createdAt: string;
};
export type AssetTagAssignment = {
  id: string;
  target: AssetTagTarget;
  assignedAt: string;
  ownerContact: boolean;
};
export type AssetTagRecord = {
  id: string;
  siteId: string;
  batchId: string;
  ordinal: number;
  token: string;
  legacy: { id: string; origin: string | null } | null;
  assignment: AssetTagAssignment | null;
};
export type AssetTagBindingEvent = {
  id: string;
  tagId: string;
  assignmentId: string;
  target: AssetTagTargetRef;
  kind: "claim" | "unlink" | "swap" | "import" | "owner_contact";
  at: string;
};
export const assetTagCoordinates = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().max(100_000),
});
export type AssetTagCoordinates = z.infer<typeof assetTagCoordinates>;
export type AssetTagScan = {
  id: string;
  tagId: string;
  assignmentId: string;
  at: string;
  source: "printed_link" | "manual" | "camera";
  coordinates: AssetTagCoordinates | null;
};

export type AssetTagOwnerMessage = {
  id: string;
  tagId: string;
  assignmentId: string;
  at: string;
  replyTo: string | null;
  message: string;
  readAt: string | null;
};

export type AssetTagWorkspace = {
  readAt?: number;
  sites: AssetTagSite[];
  targets: AssetTagTarget[];
  batches: AssetTagBatch[];
  tags: AssetTagRecord[];
  events: AssetTagBindingEvent[];
  scans: AssetTagScan[];
  messages: AssetTagOwnerMessage[];
};

const create = { requestId: id, siteId: id, title };
export const assetTagImportEntry = z.strictObject({
  identifier: z.string().trim().min(1).max(400),
  target: assetTagTargetRef,
});
export type AssetTagImportEntry = z.infer<typeof assetTagImportEntry>;
export const assetTagCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("createBatch"),
    ...create,
    count: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    type: z.literal("importLegacy"),
    ...create,
    approvedLegacyOrigin: z.string().trim().max(240).nullable(),
    entries: z.array(assetTagImportEntry).min(1).max(100),
  }),
  z.strictObject({
    type: z.literal("claim"),
    requestId: id,
    tagId: id,
    target: assetTagTargetRef,
  }),
  z.strictObject({
    type: z.literal("swap"),
    requestId: id,
    tagId: id,
    previousTagId: id,
    assignmentId: id,
  }),
  z.strictObject({
    type: z.literal("unlink"),
    requestId: id,
    tagId: id,
    assignmentId: id,
  }),
  z.strictObject({
    type: z.literal("setOwnerContact"),
    requestId: id,
    tagId: id,
    assignmentId: id,
    enabled: z.boolean(),
  }),
  z.strictObject({ type: z.literal("markMessageRead"), requestId: id, messageId: id }),
]);

export type AssetTagCommand = z.infer<typeof assetTagCommand>;
export type AssetTagError = "invalid" | "unavailable" | "conflict" | "state";
export type AssetTagResult =
  | { ok: true; value: AssetTagWorkspace; batchId: string | null; tagId: string | null }
  | { ok: false; error: AssetTagError };

export const assetTagScanInput = z.strictObject({
  identifier: z.string().min(1).max(4_096),
  source: z.enum(["printed_link", "manual", "camera"]),
  coordinates: assetTagCoordinates.nullable(),
});
export type AssetTagScanInput = z.infer<typeof assetTagScanInput>;
export type AssetTagScanResult =
  | { ok: true; target: AssetTagTarget; tagId: string; assignmentId: string }
  | { ok: false; error: "invalid" | "unavailable" };

export const assetTagContactInput = z.strictObject({
  requestId: id,
  token: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  replyTo: z.email().max(254).nullable(),
  message: z.string().trim().min(1).max(2_000),
});
export type AssetTagContactInput = z.infer<typeof assetTagContactInput>;
export type AssetTagContactResult = { ok: true } | { ok: false; error: "invalid" | "unavailable" };
