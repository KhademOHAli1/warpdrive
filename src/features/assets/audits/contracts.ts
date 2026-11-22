import { z } from "zod";

const id = z.uuid().toLowerCase();
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\u0000"));
const instant = z.iso.datetime().transform((value) => new Date(value).toISOString());
const count = z.number().int().min(0).max(1_000_000);
const amount = z.number().int().min(1).max(1_000_000);
const ids = (limit: number) =>
  z
    .array(id)
    .max(limit)
    .refine((items) => new Set(items).size === items.length);

export const equipmentAuditScope = z.strictObject({
  locationIds: ids(100),
  includeChildren: z.boolean(),
  assetIds: ids(200),
  kitIds: ids(100),
  categoryIds: ids(100),
  tag: text(100).nullable(),
  includeCustody: z.boolean(),
});
export type EquipmentAuditScope = z.infer<typeof equipmentAuditScope>;

const draft = {
  title: text(120),
  dueAt: instant.nullable(),
  scope: equipmentAuditScope,
  assigneeIds: ids(20),
};
const envelope = { auditId: id, version: z.number().int().positive(), requestId: id };
const rowCount = z.strictObject({ rowId: id, quantity: count });
const scanProof = z.strictObject({ code: text(4096), expectedTargetId: id.nullable() }).nullable();
const note = text(800);

export const equipmentAuditCommand = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("create"), requestId: id, siteId: id, ...draft }),
  z.strictObject({ type: z.literal("edit"), ...envelope, ...draft }),
  z.strictObject({ type: z.literal("assign"), ...envelope, assigneeIds: draft.assigneeIds }),
  z.strictObject({ type: z.literal("start"), ...envelope }),
  z.strictObject({
    type: z.literal("setCount"),
    ...envelope,
    rowId: id,
    quantity: count,
    mode: z.enum(["replace", "add"]),
    proof: scanProof,
  }),
  z.strictObject({
    type: z.literal("bulkCount"),
    ...envelope,
    counts: z
      .array(rowCount)
      .min(1)
      .max(100)
      .refine((rows) => new Set(rows.map(({ rowId }) => rowId)).size === rows.length),
  }),
  z.strictObject({
    type: z.literal("unexpected"),
    ...envelope,
    code: text(4096),
    expectedTargetId: id.nullable(),
    locationId: id.nullable(),
    quantity: amount,
  }),
  z.strictObject({ type: z.literal("undo"), ...envelope, rowId: id, reason: note }),
  z.strictObject({ type: z.literal("note"), ...envelope, rowId: id.nullable(), note }),
  z.strictObject({ type: z.literal("complete"), ...envelope, note: note.nullable() }),
  z.strictObject({ type: z.literal("cancel"), ...envelope, note: note.nullable() }),
  z.strictObject({ type: z.literal("archive"), ...envelope, archived: z.boolean() }),
  z.strictObject({
    type: z.literal("duplicate"),
    ...envelope,
    title: draft.title,
    dueAt: draft.dueAt,
  }),
  z.strictObject({ type: z.literal("review"), ...envelope, note: note.nullable() }),
]);

type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type EquipmentAuditCommand = z.infer<typeof equipmentAuditCommand>;
export type EquipmentAuditIntent = WithoutRequestId<EquipmentAuditCommand>;
export type EquipmentAuditStatus = "draft" | "active" | "completed" | "cancelled";
export type EquipmentAuditResultStatus =
  | "not_scanned"
  | "found"
  | "missing"
  | "unexpected"
  | "partial";

type Identity = { id: string; name: string };
export type EquipmentAuditLocation = Identity & { parentId: string | null };
export type EquipmentAuditTarget = Identity & {
  kind: "asset" | "kit";
  code: string;
};

export type EquipmentAuditSite = Identity & {
  canManage: boolean;
  locations: EquipmentAuditLocation[];
  targets: EquipmentAuditTarget[];
  categories: Identity[];
  tags: string[];
  auditors: Identity[];
};

export type EquipmentAuditProgress = {
  expectedRows: number;
  foundRows: number;
  outstandingRows: number;
  missingRows: number;
  unexpectedRows: number;
  expectedUnits: number;
  foundUnits: number;
  missingUnits: number;
  unexpectedUnits: number;
};

export type EquipmentAuditSummary = {
  id: string;
  siteId: string;
  version: number;
  title: string;
  status: EquipmentAuditStatus;
  archived: boolean;
  createdAt: string;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  reviewedAt: string | null;
  assignees: Identity[];
  progress: EquipmentAuditProgress;
};

export type EquipmentAuditPlacement = {
  kind: "storage" | "unlocated" | "kit" | "custody";
  locationId: string | null;
  kitId: string | null;
  sourceId: string | null;
  label: string | null;
};

export type EquipmentAuditRow = {
  id: string;
  target: EquipmentAuditTarget | null;
  serial: string | null;
  sourceVersion: number | null;
  placement: EquipmentAuditPlacement;
  quantityType: "single" | "pool";
  expected: number | null;
  counted: number | null;
  result: EquipmentAuditResultStatus;
  canUndo: boolean;
};

export const equipmentAuditEventKinds = [
  "created",
  "edited",
  "assigned",
  "started",
  "counted",
  "unexpected",
  "undone",
  "note",
  "photo",
  "completed",
  "cancelled",
  "archived",
  "restored",
  "duplicated",
  "reviewed",
] as const;

export type EquipmentAuditEvent = {
  id: string;
  kind: (typeof equipmentAuditEventKinds)[number];
  at: string;
  actor: string;
  rowId: string | null;
  rowName: string | null;
  before: number | null;
  after: number | null;
  note: string | null;
};

export type EquipmentAuditEvidence = {
  id: string;
  rowId: string | null;
  name: string;
  href: string;
  source: "camera" | "file";
  at: string;
  actor: string;
};

export type EquipmentAuditDetail = EquipmentAuditSummary & {
  siteName: string;
  scope: EquipmentAuditScope;
  canManage: boolean;
  canCount: boolean;
  rows: EquipmentAuditRow[];
  activity: EquipmentAuditEvent[];
  evidence: EquipmentAuditEvidence[];
};

export type EquipmentAuditWorkspace = {
  readAt?: number;
  viewerId: string;
  sites: EquipmentAuditSite[];
  audits: EquipmentAuditSummary[];
};

export type EquipmentAuditError =
  | "invalid"
  | "unavailable"
  | "stale"
  | "conflict"
  | "state"
  | "quantity"
  | "storage";
type Failure = { ok: false; error: EquipmentAuditError };

export type EquipmentAuditRead = { ok: true; value: EquipmentAuditDetail } | Failure;
export type EquipmentAuditWrite =
  | {
      ok: true;
      workspace: EquipmentAuditWorkspace;
      detail: EquipmentAuditDetail;
    }
  | Failure;

export type EquipmentAuditLookup =
  | {
      ok: true;
      targetId: string | null;
      rows: string[];
      label: string | null;
    }
  | Failure;

export type EquipmentAuditAttach = {
  auditId: string;
  rowId: string | null;
  version: number;
  requestId: string;
  source: EquipmentAuditEvidence["source"];
  file: File;
};

export type EquipmentAuditAccess = {
  read: (auditId: string) => Promise<EquipmentAuditRead>;
  submit: (command: EquipmentAuditCommand) => Promise<EquipmentAuditWrite>;
  lookup: (auditId: string, code: string) => Promise<EquipmentAuditLookup>;
  attach: (input: EquipmentAuditAttach) => Promise<EquipmentAuditWrite>;
};
