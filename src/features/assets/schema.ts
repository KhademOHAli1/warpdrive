import { sql } from "drizzle-orm";
import {
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
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import type { AssetEventKind, AssetField, AssetModel, AssetTracking } from "./contracts";

export const assetCategories = pgTable(
  "asset_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    fields: jsonb("fields").$type<AssetField[]>().notNull().default(sql`'[]'::jsonb`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("asset_categories_site_id_key").on(table.siteId, table.id),
    unique("asset_categories_site_name_key").on(table.siteId, table.nameKey),
    check(
      "asset_categories_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 120 AND length(btrim(${table.nameKey})) > 0`,
    ),
    check(
      "asset_categories_fields_check",
      sql`CASE WHEN jsonb_typeof(${table.fields}) = 'array' THEN jsonb_array_length(${table.fields}) <= 32 ELSE false END`,
    ),
    check("asset_categories_version_check", sql`${table.version} > 0`),
  ],
);

function assetMetadata() {
  return {
    code: text("code").notNull(),
    codeKey: text("code_key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: uuid("category_id"),
    tags: jsonb("tags").$type<AssetModel["tags"]>().notNull().default(sql`'[]'::jsonb`),
    fieldValues: jsonb("field_values")
      .$type<AssetModel["fieldValues"]>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
  };
}

export const assetModels = pgTable(
  "asset_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    ...assetMetadata(),
  },
  (table) => [
    unique("asset_models_site_id_key").on(table.siteId, table.id),
    unique("asset_models_site_code_key").on(table.siteId, table.codeKey),
    foreignKey({
      name: "asset_models_category_fk",
      columns: [table.siteId, table.categoryId],
      foreignColumns: [assetCategories.siteId, assetCategories.id],
    }),
    index("asset_models_category_idx").on(table.siteId, table.categoryId),
    check(
      "asset_models_metadata_check",
      sql`length(btrim(${table.code})) BETWEEN 1 AND 80 AND length(btrim(${table.codeKey})) > 0
        AND length(btrim(${table.name})) BETWEEN 1 AND 120
        AND length(btrim(${table.description})) BETWEEN 1 AND 1000`,
    ),
    check(
      "asset_models_values_check",
      sql`jsonb_typeof(${table.tags}) = 'array' AND jsonb_typeof(${table.fieldValues}) = 'object'`,
    ),
    check("asset_models_version_check", sql`${table.version} > 0`),
  ],
);

export const assetRecords = pgTable(
  "asset_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    ...assetMetadata(),
    tracking: text("tracking").$type<AssetTracking>().notNull(),
    serial: text("serial"),
    serialKey: text("serial_key"),
    modelId: uuid("model_id"),
    locationId: uuid("location_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("asset_records_site_id_key").on(table.siteId, table.id),
    unique("asset_records_site_code_key").on(table.siteId, table.codeKey),
    unique("asset_records_site_serial_key").on(table.siteId, table.serialKey),
    foreignKey({
      name: "asset_records_category_fk",
      columns: [table.siteId, table.categoryId],
      foreignColumns: [assetCategories.siteId, assetCategories.id],
    }),
    foreignKey({
      name: "asset_records_model_fk",
      columns: [table.siteId, table.modelId],
      foreignColumns: [assetModels.siteId, assetModels.id],
    }),
    foreignKey({
      name: "asset_records_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    index("asset_records_category_idx").on(table.siteId, table.categoryId),
    index("asset_records_model_idx").on(table.siteId, table.modelId),
    index("asset_records_active_location_idx")
      .on(table.siteId, table.locationId)
      .where(sql`${table.archivedAt} IS NULL`),
    check(
      "asset_records_metadata_check",
      sql`length(btrim(${table.code})) BETWEEN 1 AND 80 AND length(btrim(${table.codeKey})) > 0
        AND length(btrim(${table.name})) BETWEEN 1 AND 120
        AND length(btrim(${table.description})) BETWEEN 1 AND 1000`,
    ),
    check(
      "asset_records_values_check",
      sql`jsonb_typeof(${table.tags}) = 'array' AND jsonb_typeof(${table.fieldValues}) = 'object'`,
    ),
    check(
      "asset_records_tracking_check",
      sql`${table.tracking} = 'individual' OR (${table.tracking} IN ('returnable_pool', 'consumable_pool')
        AND ${table.serial} IS NULL AND ${table.modelId} IS NULL AND ${table.locationId} IS NULL)`,
    ),
    check(
      "asset_records_serial_check",
      sql`(${table.serial} IS NULL) = (${table.serialKey} IS NULL)
        AND (${table.serial} IS NULL OR (
          length(btrim(${table.serial})) BETWEEN 1 AND 80 AND length(btrim(${table.serialKey})) > 0
        ))`,
    ),
    check("asset_records_version_check", sql`${table.version} > 0`),
  ],
);

export const assetBalances = pgTable(
  "asset_balances",
  {
    assetId: uuid("asset_id").notNull(),
    siteId: uuid("site_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({
      name: "asset_balances_pkey",
      columns: [table.assetId, table.locationId],
    }),
    foreignKey({
      name: "asset_balances_asset_fk",
      columns: [table.siteId, table.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_balances_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    index("asset_balances_location_idx").on(table.siteId, table.locationId),
    check("asset_balances_quantity_check", sql`${table.quantity} BETWEEN 1 AND 1000000`),
  ],
);

export const assetEvents = pgTable(
  "asset_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetId: uuid("asset_id").notNull(),
    siteId: uuid("site_id").notNull(),
    kind: text("kind").$type<AssetEventKind>().notNull(),
    version: integer("version").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    fromLocationId: uuid("from_location_id"),
    locationId: uuid("location_id"),
    quantity: integer("quantity"),
  },
  (table) => [
    foreignKey({
      name: "asset_events_asset_fk",
      columns: [table.siteId, table.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_events_source_location_fk",
      columns: [table.siteId, table.fromLocationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    foreignKey({
      name: "asset_events_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    unique("asset_events_version_key").on(table.assetId, table.version),
    index("asset_events_site_asset_idx").on(table.siteId, table.assetId),
    check("asset_events_version_check", sql`${table.version} > 0`),
    check(
      "asset_events_kind_check",
      sql`${table.kind} IN ('created', 'updated', 'moved', 'restocked', 'consumed', 'adjusted', 'archived', 'reinstated', 'note')`,
    ),
    check("asset_events_reason_check", sql`length(btrim(${table.reason})) BETWEEN 1 AND 400`),
    check("asset_events_quantity_check", sql`${table.quantity} BETWEEN -1000000 AND 1000000`),
  ],
);

export const assetCommandReceipts = pgTable(
  "asset_command_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    fingerprint: text("fingerprint").notNull(),
    focusId: uuid("focus_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "asset_command_receipts_pkey",
      columns: [table.actorId, table.requestId],
    }),
    foreignKey({
      name: "asset_command_receipts_focus_fk",
      columns: [table.siteId, table.focusId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    check("asset_command_receipts_fingerprint_check", sql`${table.fingerprint} ~ '^[a-f0-9]{64}$'`),
  ],
);

export type AssetCategoryRow = typeof assetCategories.$inferSelect;
export type AssetModelRow = typeof assetModels.$inferSelect;
export type AssetRecordRow = typeof assetRecords.$inferSelect;
