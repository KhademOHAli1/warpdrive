import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directorySites } from "@/features/locations/schema";
import { assetModels, assetRecords } from "../schema";
import type {
  AssetMediaEvent,
  AssetMediaKind,
  AssetMediaMime,
  AssetMediaTarget,
} from "./contracts";

export const assetMediaTargets = pgTable(
  "asset_media_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    targetType: text("target_type").$type<AssetMediaTarget["type"]>().notNull(),
    assetId: uuid("asset_id"),
    modelId: uuid("model_id"),
    version: integer("version").notNull().default(0),
  },
  (row) => [
    unique("asset_media_targets_site_key").on(row.siteId, row.id),
    unique("asset_media_targets_asset_key").on(row.siteId, row.assetId),
    unique("asset_media_targets_model_key").on(row.siteId, row.modelId),
    foreignKey({
      name: "asset_media_targets_asset_fk",
      columns: [row.siteId, row.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_media_targets_model_fk",
      columns: [row.siteId, row.modelId],
      foreignColumns: [assetModels.siteId, assetModels.id],
    }),
    check(
      "asset_media_targets_value_check",
      sql`${row.version} >= 0 AND (
      (${row.targetType} = 'asset' AND ${row.assetId} IS NOT NULL AND ${row.modelId} IS NULL)
      OR (${row.targetType} = 'model' AND ${row.modelId} IS NOT NULL AND ${row.assetId} IS NULL)
    )`,
    ),
  ],
);

export const assetMediaEvents = pgTable(
  "asset_media_events",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    targetId: uuid("target_id").notNull(),
    version: integer("version").notNull(),
    type: text("type").$type<AssetMediaEvent["type"]>().notNull(),
    fileId: uuid("file_id"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    kind: text("kind").$type<AssetMediaKind>(),
    name: text("name"),
    mime: text("mime").$type<AssetMediaMime>(),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    objectKey: text("object_key"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  },
  (row) => [
    unique("asset_media_events_scope_key").on(row.siteId, row.targetId, row.id),
    unique("asset_media_events_version_key").on(row.targetId, row.version),
    unique("asset_media_events_object_key").on(row.objectKey),
    foreignKey({
      name: "asset_media_events_target_fk",
      columns: [row.siteId, row.targetId],
      foreignColumns: [assetMediaTargets.siteId, assetMediaTargets.id],
    }),
    foreignKey({
      name: "asset_media_events_file_fk",
      columns: [row.siteId, row.targetId, row.fileId],
      foreignColumns: [row.siteId, row.targetId, row.id],
    }),
    check("asset_media_events_version_check", sql`${row.version} > 0`),
    check(
      "asset_media_events_payload_check",
      sql`
      (${row.type} = 'uploaded' AND ${row.fileId} IS NOT NULL AND ${row.fileId} = ${row.id}
        AND ${row.name} IS NOT NULL AND length(btrim(${row.name})) BETWEEN 1 AND 180
        AND ${row.sha256} IS NOT NULL AND ${row.sha256} ~ '^[0-9a-f]{64}$'
        AND ${row.objectKey} IS NOT NULL AND length(${row.objectKey}) BETWEEN 1 AND 350
        AND ${row.kind} IS NOT NULL AND ${row.mime} IS NOT NULL AND ${row.sizeBytes} IS NOT NULL
        AND (
          (${row.kind} = 'photo' AND ${row.mime} IN ('image/jpeg','image/png')
            AND ${row.sizeBytes} BETWEEN 1 AND 5242880)
          OR (${row.kind} = 'document' AND ${row.mime} = 'application/pdf'
            AND ${row.sizeBytes} BETWEEN 1 AND 10485760)
        ))
      OR (${row.type} = 'cover_changed' AND ${row.name} IS NULL AND ${row.sha256} IS NULL
        AND ${row.objectKey} IS NULL AND ${row.kind} IS NULL AND ${row.mime} IS NULL
        AND ${row.sizeBytes} IS NULL)
    `,
    ),
  ],
);

export const assetMediaReceipts = pgTable(
  "asset_media_receipts",
  {
    eventId: uuid("event_id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    targetId: uuid("target_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
  },
  (row) => [
    unique("asset_media_receipts_actor_request_key").on(row.actorId, row.requestId),
    foreignKey({
      name: "asset_media_receipts_event_fk",
      columns: [row.siteId, row.targetId, row.eventId],
      foreignColumns: [assetMediaEvents.siteId, assetMediaEvents.targetId, assetMediaEvents.id],
    }),
    check("asset_media_receipts_fingerprint_check", sql`${row.fingerprint} ~ '^[0-9a-f]{64}$'`),
  ],
);
