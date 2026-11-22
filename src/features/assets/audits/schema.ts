import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directorySites } from "@/features/locations/schema";
import type {
  EquipmentAuditEvent,
  EquipmentAuditEvidence,
  EquipmentAuditScope,
  EquipmentAuditStatus,
} from "./contracts";
import type { AuditFinding } from "./state";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const assetAudits = pgTable(
  "asset_audits",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<EquipmentAuditStatus>().notNull(),
    archived: boolean("archived").notNull().default(false),
    scope: jsonb("scope").$type<EquipmentAuditScope>().notNull(),
    createdAt: instant("created_at").notNull(),
    dueAt: instant("due_at"),
    startedAt: instant("started_at"),
    completedAt: instant("completed_at"),
    reviewedAt: instant("reviewed_at"),
  },
  (row) => [
    unique("asset_audits_site_identity_key").on(row.siteId, row.id),
    index("asset_audits_site_created_idx").on(row.siteId, row.createdAt, row.id),
    check(
      "asset_audits_state_check",
      sql`
      ${row.version} > 0 AND length(btrim(${row.title})) BETWEEN 1 AND 120
      AND ${row.status} IN ('draft','active','completed','cancelled')
      AND (${row.status} NOT IN ('active','completed') OR ${row.startedAt} IS NOT NULL)
      AND (${row.status} = 'completed') = (${row.completedAt} IS NOT NULL)
      AND (${row.reviewedAt} IS NULL OR ${row.status} = 'completed')
      AND (NOT ${row.archived} OR ${row.status} IN ('completed','cancelled'))
      AND jsonb_typeof(${row.scope}) = 'object'`,
    ),
  ],
);

export const assetAuditAssignments = pgTable(
  "asset_audit_assignments",
  {
    auditId: uuid("audit_id").notNull(),
    siteId: uuid("site_id").notNull(),
    participantId: uuid("participant_id").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.auditId, row.participantId] }),
    index("asset_audit_assignments_user_idx").on(row.userId, row.siteId, row.auditId),
    unique("asset_audit_assignments_order_key").on(row.auditId, row.position),
    foreignKey({
      name: "asset_audit_assignments_audit_fk",
      columns: [row.siteId, row.auditId],
      foreignColumns: [assetAudits.siteId, assetAudits.id],
    }),
    check(
      "asset_audit_assignments_value_check",
      sql`${row.position} BETWEEN 0 AND 19 AND length(btrim(${row.name})) > 0
        AND (${row.userId} IS NULL OR ${row.userId} = ${row.participantId})`,
    ),
  ],
);

type FindingIdentity = Pick<
  AuditFinding,
  "target" | "serial" | "sourceVersion" | "placement" | "quantityType"
>;

export const assetAuditRows = pgTable(
  "asset_audit_rows",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    auditId: uuid("audit_id").notNull(),
    position: integer("position").notNull(),
    expected: integer("expected"),
    counted: integer("counted"),
    opaqueKey: text("opaque_key"),
    identity: jsonb("identity").$type<FindingIdentity>().notNull(),
  },
  (row) => [
    unique("asset_audit_rows_scope_key").on(row.siteId, row.auditId, row.id),
    unique("asset_audit_rows_position_key").on(row.auditId, row.position),
    uniqueIndex("asset_audit_rows_opaque_key")
      .on(row.auditId, row.opaqueKey)
      .where(sql`${row.opaqueKey} IS NOT NULL`),
    foreignKey({
      name: "asset_audit_rows_audit_fk",
      columns: [row.siteId, row.auditId],
      foreignColumns: [assetAudits.siteId, assetAudits.id],
    }),
    check(
      "asset_audit_rows_value_check",
      sql`${row.position} >= 0 AND (${row.expected} IS NULL OR ${row.expected} > 0)
        AND (${row.counted} IS NULL OR ${row.counted} BETWEEN 0 AND 1000000)
        AND (${row.opaqueKey} IS NULL OR (${row.expected} IS NULL AND ${row.opaqueKey} ~ '^[0-9a-f]{64}$'))
        AND jsonb_typeof(${row.identity}) = 'object'`,
    ),
  ],
);

type EventSnapshot = Omit<EquipmentAuditEvent, "id" | "rowId" | "at">;

export const assetAuditEvents = pgTable(
  "asset_audit_events",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    auditId: uuid("audit_id").notNull(),
    rowId: uuid("row_id"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull(),
    ordinal: integer("ordinal").notNull(),
    at: instant("at").notNull(),
    snapshot: jsonb("snapshot").$type<EventSnapshot>().notNull(),
  },
  (row) => [
    unique("asset_audit_events_batch_key").on(row.auditId, row.version, row.ordinal),
    foreignKey({
      name: "asset_audit_events_audit_fk",
      columns: [row.siteId, row.auditId],
      foreignColumns: [assetAudits.siteId, assetAudits.id],
    }),
    foreignKey({
      name: "asset_audit_events_row_fk",
      columns: [row.siteId, row.auditId, row.rowId],
      foreignColumns: [assetAuditRows.siteId, assetAuditRows.auditId, assetAuditRows.id],
    }),
    check(
      "asset_audit_events_value_check",
      sql`${row.version} > 0 AND ${row.ordinal} >= 0 AND jsonb_typeof(${row.snapshot}) = 'object'`,
    ),
  ],
);

export const assetAuditReceipts = pgTable(
  "asset_audit_receipts",
  {
    id: uuid("id").primaryKey(),
    requestId: uuid("request_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    siteId: uuid("site_id").notNull(),
    sourceAuditId: uuid("source_audit_id"),
    auditId: uuid("audit_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    at: instant("at").notNull(),
  },
  (row) => [
    unique("asset_audit_receipts_actor_request_key").on(row.actorId, row.requestId),
    foreignKey({
      name: "asset_audit_receipts_result_fk",
      columns: [row.siteId, row.auditId],
      foreignColumns: [assetAudits.siteId, assetAudits.id],
    }),
    foreignKey({
      name: "asset_audit_receipts_source_fk",
      columns: [row.siteId, row.sourceAuditId],
      foreignColumns: [assetAudits.siteId, assetAudits.id],
    }),
    check("asset_audit_receipts_fingerprint_check", sql`${row.fingerprint} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const assetAuditEvidence = pgTable(
  "asset_audit_evidence",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    auditId: uuid("audit_id").notNull(),
    rowId: uuid("row_id"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actor: text("actor").notNull(),
    name: text("name").notNull(),
    source: text("source").$type<EquipmentAuditEvidence["source"]>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type").$type<"image/png" | "image/jpeg">().notNull(),
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull(),
    at: instant("at").notNull(),
  },
  (row) => [
    unique("asset_audit_evidence_object_key").on(row.objectKey),
    index("asset_audit_evidence_audit_idx").on(row.auditId, row.at, row.id),
    foreignKey({
      name: "asset_audit_evidence_audit_fk",
      columns: [row.siteId, row.auditId],
      foreignColumns: [assetAudits.siteId, assetAudits.id],
    }),
    foreignKey({
      name: "asset_audit_evidence_row_fk",
      columns: [row.siteId, row.auditId, row.rowId],
      foreignColumns: [assetAuditRows.siteId, assetAuditRows.auditId, assetAuditRows.id],
    }),
    check(
      "asset_audit_evidence_value_check",
      sql`${row.source} IN ('camera','file') AND ${row.contentType} IN ('image/png','image/jpeg')
        AND ${row.sizeBytes} BETWEEN 1 AND 10485760 AND ${row.sha256} ~ '^[0-9a-f]{64}$'
        AND length(${row.name}) BETWEEN 1 AND 180`,
    ),
  ],
);
