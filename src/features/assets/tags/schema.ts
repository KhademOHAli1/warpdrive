import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directorySites } from "@/features/locations/schema";
import { assetKits } from "../kits/schema";
import { assetRecords } from "../schema";
import type {
  AssetTagBatch,
  AssetTagBindingEvent,
  AssetTagCommand,
  AssetTagScan,
  AssetTagTargetRef,
} from "./contracts";

const instant = (name: string) => timestamp(name, { withTimezone: true });
const now = sql`clock_timestamp()`;

export const assetTagBatches = pgTable(
  "asset_tag_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    title: text("title").notNull(),
    source: text("source").$type<AssetTagBatch["source"]>().notNull(),
    createdAt: instant("created_at").notNull().default(now),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (row) => [
    unique("asset_tag_batches_site_id_key").on(row.siteId, row.id),
    index("asset_tag_batches_site_created_idx").on(row.siteId, row.createdAt),
    check(
      "asset_tag_batches_metadata_check",
      sql`${row.source} IN ('printed', 'imported') AND length(btrim(${row.title})) BETWEEN 1 AND 100`,
    ),
  ],
);

export const assetTagCodes = pgTable(
  "asset_tag_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    token: text("token").notNull(),
    legacyId: text("legacy_id"),
    legacyOrigin: text("legacy_origin"),
  },
  (row) => [
    unique("asset_tag_codes_site_id_key").on(row.siteId, row.id),
    unique("asset_tag_codes_batch_ordinal_key").on(row.batchId, row.ordinal),
    uniqueIndex("asset_tag_codes_token_uidx").on(sql`${row.token} COLLATE "C"`),
    uniqueIndex("asset_tag_codes_legacy_uidx")
      .on(sql`${row.legacyId} COLLATE "C"`)
      .where(sql`${row.legacyId} IS NOT NULL`),
    foreignKey({
      name: "asset_tag_codes_batch_fk",
      columns: [row.siteId, row.batchId],
      foreignColumns: [assetTagBatches.siteId, assetTagBatches.id],
    }),
    check(
      "asset_tag_codes_identity_check",
      sql`${row.ordinal} BETWEEN 1 AND 100 AND ${row.token} COLLATE "C" ~ '^[A-Za-z0-9_-]{22}$'`,
    ),
    check(
      "asset_tag_codes_legacy_check",
      sql`CASE WHEN ${row.legacyId} IS NULL THEN ${row.legacyOrigin} IS NULL
        ELSE ${row.legacyId} COLLATE "C" ~ '^[a-z][a-z0-9]{6,23}$'
          AND ${row.legacyId} COLLATE "C" ~ '[0-9]'
          AND (${row.legacyOrigin} IS NULL OR (
            length(${row.legacyOrigin}) <= 240
            AND ${row.legacyOrigin} COLLATE "C" ~ '^https?://[^/?#@%[:space:]]+$'
            AND strpos(${row.legacyOrigin}, chr(92)) = 0
          ))
        END`,
    ),
  ],
);

export const assetTagAssignments = pgTable(
  "asset_tag_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    targetKind: text("target_kind").$type<AssetTagTargetRef["kind"]>().notNull(),
    targetId: uuid("target_id").notNull(),
    assetId: uuid("asset_id"),
    kitId: uuid("kit_id"),
    assignedAt: instant("assigned_at").notNull().default(now),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    endedAt: instant("ended_at"),
    endedBy: uuid("ended_by").references(() => users.id, { onDelete: "set null" }),
    ownerContact: boolean("owner_contact").notNull().default(false),
  },
  (row) => [
    unique("asset_tag_assignments_scope_id_key").on(row.siteId, row.tagId, row.id),
    index("asset_tag_assignments_tag_history_idx").on(row.siteId, row.tagId, row.assignedAt),
    uniqueIndex("asset_tag_assignments_active_tag_uidx")
      .on(row.siteId, row.tagId)
      .where(sql`${row.endedAt} IS NULL`),
    uniqueIndex("asset_tag_assignments_active_subject_uidx")
      .on(row.siteId, row.targetKind, row.targetId)
      .where(sql`${row.endedAt} IS NULL`),
    foreignKey({
      name: "asset_tag_assignments_tag_fk",
      columns: [row.siteId, row.tagId],
      foreignColumns: [assetTagCodes.siteId, assetTagCodes.id],
    }),
    foreignKey({
      name: "asset_tag_assignments_asset_fk",
      columns: [row.siteId, row.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_tag_assignments_kit_fk",
      columns: [row.siteId, row.kitId],
      foreignColumns: [assetKits.siteId, assetKits.id],
    }),
    check(
      "asset_tag_assignments_target_check",
      sql`num_nonnulls(${row.assetId}, ${row.kitId}) = 1
        AND ${row.targetId} IS NOT DISTINCT FROM CASE ${row.targetKind}
          WHEN 'asset' THEN ${row.assetId}
          WHEN 'kit' THEN ${row.kitId}
        END`,
    ),
    check(
      "asset_tag_assignments_end_check",
      sql`CASE WHEN ${row.endedAt} IS NULL THEN ${row.endedBy} IS NULL
        ELSE ${row.endedAt} >= ${row.assignedAt} END`,
    ),
  ],
);

function tagEpochColumns() {
  return {
    siteId: uuid("site_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
  };
}

function tagEpochReference(
  name: string,
  row: { siteId: AnyPgColumn; tagId: AnyPgColumn; assignmentId: AnyPgColumn },
) {
  return foreignKey({
    name,
    columns: [row.siteId, row.tagId, row.assignmentId],
    foreignColumns: [assetTagAssignments.siteId, assetTagAssignments.tagId, assetTagAssignments.id],
  });
}

export const assetTagBindingEvents = pgTable(
  "asset_tag_binding_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...tagEpochColumns(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").$type<AssetTagBindingEvent["kind"]>().notNull(),
    at: instant("at").notNull().default(now),
    ownerContactEnabled: boolean("owner_contact_enabled"),
  },
  (row) => [
    tagEpochReference("asset_tag_binding_events_assignment_fk", row),
    index("asset_tag_binding_events_site_at_idx").on(row.siteId, row.at),
    check(
      "asset_tag_binding_events_kind_check",
      sql`${row.kind} IN ('claim', 'unlink', 'swap', 'import', 'owner_contact')
        AND (${row.kind} = 'owner_contact') = (${row.ownerContactEnabled} IS NOT NULL)`,
    ),
  ],
);

export const assetTagScans = pgTable(
  "asset_tag_scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...tagEpochColumns(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    at: instant("at").notNull().default(now),
    source: text("source").$type<AssetTagScan["source"]>().notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    accuracy: doublePrecision("accuracy"),
  },
  (row) => [
    tagEpochReference("asset_tag_scans_assignment_fk", row),
    index("asset_tag_scans_site_at_idx").on(row.siteId, row.at),
    index("asset_tag_scans_dedupe_idx").on(row.assignmentId, row.actorId, row.at),
    check(
      "asset_tag_scans_source_check",
      sql`${row.source} IN ('printed_link', 'manual', 'camera')`,
    ),
    check(
      "asset_tag_scans_coordinates_check",
      sql`num_nonnulls(${row.latitude}, ${row.longitude}, ${row.accuracy}) = 0 OR (
          num_nonnulls(${row.latitude}, ${row.longitude}, ${row.accuracy}) = 3
          AND ${row.latitude} BETWEEN -90 AND 90 AND ${row.longitude} BETWEEN -180 AND 180
          AND ${row.accuracy} BETWEEN 0 AND 100000
        )`,
    ),
  ],
);

export const assetTagOwnerMessages = pgTable(
  "asset_tag_owner_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...tagEpochColumns(),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    at: instant("at").notNull().default(now),
    replyTo: text("reply_to"),
    message: text("message").notNull(),
    readAt: instant("read_at"),
    readBy: uuid("read_by").references(() => users.id, { onDelete: "set null" }),
  },
  (row) => [
    tagEpochReference("asset_tag_owner_messages_assignment_fk", row),
    unique("asset_tag_owner_messages_request_key").on(row.assignmentId, row.requestId),
    index("asset_tag_owner_messages_site_at_idx").on(row.siteId, row.at),
    check(
      "asset_tag_owner_messages_text_check",
      sql`length(btrim(${row.message})) BETWEEN 1 AND 2000
        AND (${row.replyTo} IS NULL OR length(btrim(${row.replyTo})) BETWEEN 1 AND 254)`,
    ),
    check(
      "asset_tag_owner_messages_fingerprint_check",
      sql`${row.fingerprint} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "asset_tag_owner_messages_read_check",
      sql`CASE WHEN ${row.readAt} IS NULL THEN ${row.readBy} IS NULL ELSE ${row.readAt} >= ${row.at} END`,
    ),
  ],
);

export const assetTagReceipts = pgTable(
  "asset_tag_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    requestId: uuid("request_id").notNull(),
    siteId: uuid("site_id").notNull(),
    batchId: uuid("batch_id"),
    tagId: uuid("tag_id"),
    commandType: text("command_type").$type<AssetTagCommand["type"]>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: instant("created_at").notNull().default(now),
  },
  (row) => [
    unique("asset_tag_receipts_actor_request_key").on(row.actorId, row.requestId),
    foreignKey({
      name: "asset_tag_receipts_batch_fk",
      columns: [row.siteId, row.batchId],
      foreignColumns: [assetTagBatches.siteId, assetTagBatches.id],
    }),
    foreignKey({
      name: "asset_tag_receipts_tag_fk",
      columns: [row.siteId, row.tagId],
      foreignColumns: [assetTagCodes.siteId, assetTagCodes.id],
    }),
    check(
      "asset_tag_receipts_command_check",
      sql`CASE WHEN ${row.commandType} IN ('createBatch', 'importLegacy')
        THEN ${row.batchId} IS NOT NULL AND ${row.tagId} IS NULL
        WHEN ${row.commandType} IN ('claim', 'swap', 'unlink', 'setOwnerContact', 'markMessageRead')
        THEN ${row.batchId} IS NULL AND ${row.tagId} IS NOT NULL
        ELSE false END`,
    ),
    check(
      "asset_tag_receipts_fingerprint_check",
      sql`${row.fingerprint} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export type AssetTagBatchRow = typeof assetTagBatches.$inferSelect;
export type AssetTagCodeRow = typeof assetTagCodes.$inferSelect;
export type AssetTagAssignmentRow = typeof assetTagAssignments.$inferSelect;
export type AssetTagBindingEventRow = typeof assetTagBindingEvents.$inferSelect;
export type AssetTagScanRow = typeof assetTagScans.$inferSelect;
export type AssetTagOwnerMessageRow = typeof assetTagOwnerMessages.$inferSelect;
export type AssetTagReceiptRow = typeof assetTagReceipts.$inferSelect;
