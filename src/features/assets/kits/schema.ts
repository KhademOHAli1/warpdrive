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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { assetCustodians } from "../custody/schema";
import { assetModels, assetRecords } from "../schema";
import type { Kit, KitActivity, KitMember, KitReturn } from "./contracts";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const assetKits = pgTable(
  "asset_kits",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    code: text("code").notNull(),
    codeKey: text("code_key").notNull(),
    name: text("name").notNull(),
    locationId: uuid("location_id").notNull(),
    version: integer("version").notNull(),
    definitionVersion: integer("definition_version").notNull(),
  },
  (row) => [
    unique("asset_kits_site_id_key").on(row.siteId, row.id),
    unique("asset_kits_site_code_key").on(row.siteId, row.codeKey),
    foreignKey({
      name: "asset_kits_location_fk",
      columns: [row.siteId, row.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    index("asset_kits_site_location_idx").on(row.siteId, row.locationId),
    check(
      "asset_kits_identity_check",
      sql`length(btrim(${row.code})) BETWEEN 1 AND 80 AND length(btrim(${row.codeKey})) > 0
        AND length(btrim(${row.name})) BETWEEN 1 AND 120`,
    ),
    check(
      "asset_kits_version_check",
      sql`${row.definitionVersion} > 0 AND ${row.version} >= ${row.definitionVersion}`,
    ),
  ],
);

export const assetKitMembers = pgTable(
  "asset_kit_members",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    kitId: uuid("kit_id").notNull(),
    mode: text("mode").$type<KitMember["mode"]>().notNull(),
    assetId: uuid("asset_id").notNull(),
    modelId: uuid("model_id"),
    quantity: integer("quantity").notNull(),
    sourceLocationId: uuid("source_location_id"),
    packedQuantity: integer("packed_quantity").notNull(),
  },
  (row) => [
    foreignKey({
      name: "asset_kit_members_kit_fk",
      columns: [row.siteId, row.kitId],
      foreignColumns: [assetKits.siteId, assetKits.id],
    }),
    foreignKey({
      name: "asset_kit_members_asset_fk",
      columns: [row.siteId, row.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_kit_members_model_fk",
      columns: [row.siteId, row.modelId],
      foreignColumns: [assetModels.siteId, assetModels.id],
    }),
    foreignKey({
      name: "asset_kit_members_source_fk",
      columns: [row.siteId, row.sourceLocationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    uniqueIndex("asset_kit_members_individual_key")
      .on(row.assetId)
      .where(sql`${row.mode} IN ('individual', 'model')`),
    index("asset_kit_members_site_kit_idx").on(row.siteId, row.kitId),
    index("asset_kit_members_site_asset_idx").on(row.siteId, row.assetId),
    index("asset_kit_members_site_source_idx").on(row.siteId, row.sourceLocationId),
    check(
      "asset_kit_members_mode_check",
      sql`(${row.mode} = 'individual' AND ${row.modelId} IS NULL AND ${row.quantity} = 1)
        OR (${row.mode} = 'model' AND ${row.modelId} IS NOT NULL AND ${row.quantity} = 1)
        OR (${row.mode} IN ('returnable_pool', 'consumable_pool') AND ${row.modelId} IS NULL
          AND ${row.sourceLocationId} IS NOT NULL)`,
    ),
    check(
      "asset_kit_members_quantity_check",
      sql`${row.quantity} BETWEEN 1 AND 1000000 AND ${row.packedQuantity} BETWEEN 0 AND ${row.quantity}`,
    ),
  ],
);

export const assetKitDefinitions = pgTable(
  "asset_kit_definitions",
  {
    kitId: uuid("kit_id").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    siteId: uuid("site_id").notNull(),
    snapshot: jsonb("snapshot")
      .$type<Pick<Kit, "code" | "name" | "locationId" | "lines">>()
      .notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.kitId, row.definitionVersion] }),
    unique("asset_kit_definitions_scope_key").on(row.siteId, row.kitId, row.definitionVersion),
    foreignKey({
      name: "asset_kit_definitions_kit_fk",
      columns: [row.siteId, row.kitId],
      foreignColumns: [assetKits.siteId, assetKits.id],
    }),
    check("asset_kit_definitions_version_check", sql`${row.definitionVersion} > 0`),
    check(
      "asset_kit_definitions_snapshot_check",
      sql`CASE WHEN jsonb_typeof(${row.snapshot}) = 'object'
        AND jsonb_typeof(${row.snapshot}->'code') = 'string'
        AND jsonb_typeof(${row.snapshot}->'name') = 'string'
        AND jsonb_typeof(${row.snapshot}->'locationId') = 'string'
        AND jsonb_typeof(${row.snapshot}->'lines') = 'array'
        THEN jsonb_array_length(${row.snapshot}->'lines') <= 60 ELSE false END`,
    ),
  ],
);

export const assetKitCheckouts = pgTable(
  "asset_kit_checkouts",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    kitId: uuid("kit_id").notNull(),
    kitCode: text("kit_code").notNull(),
    kitName: text("kit_name").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    locationId: uuid("location_id").notNull(),
    custodianId: uuid("custodian_id").notNull(),
    custodianName: text("custodian_name").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    at: instant("at").notNull(),
    closedAt: instant("closed_at"),
    note: text("note"),
  },
  (row) => [
    unique("asset_kit_checkouts_site_id_key").on(row.siteId, row.id),
    unique("asset_kit_checkouts_site_kit_id_key").on(row.siteId, row.kitId, row.id),
    uniqueIndex("asset_kit_checkouts_open_key").on(row.kitId).where(sql`${row.closedAt} IS NULL`),
    foreignKey({
      name: "asset_kit_checkouts_definition_fk",
      columns: [row.siteId, row.kitId, row.definitionVersion],
      foreignColumns: [
        assetKitDefinitions.siteId,
        assetKitDefinitions.kitId,
        assetKitDefinitions.definitionVersion,
      ],
    }),
    foreignKey({
      name: "asset_kit_checkouts_location_fk",
      columns: [row.siteId, row.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    foreignKey({
      name: "asset_kit_checkouts_custodian_fk",
      columns: [row.siteId, row.custodianId],
      foreignColumns: [assetCustodians.siteId, assetCustodians.id],
    }),
    check(
      "asset_kit_checkouts_snapshot_check",
      sql`length(btrim(${row.kitCode})) BETWEEN 1 AND 80
        AND length(btrim(${row.kitName})) BETWEEN 1 AND 120 AND length(btrim(${row.custodianName})) > 0`,
    ),
    check("asset_kit_checkouts_closed_check", sql`${row.closedAt} >= ${row.at}`),
    check("asset_kit_checkouts_note_check", sql`length(btrim(${row.note})) BETWEEN 1 AND 400`),
  ],
);

export const assetKitCheckoutLines = pgTable(
  "asset_kit_checkout_lines",
  {
    id: uuid("id").notNull(),
    siteId: uuid("site_id").notNull(),
    checkoutId: uuid("checkout_id").notNull(),
    mode: text("mode").$type<KitMember["mode"]>().notNull(),
    requestedAssetId: uuid("requested_asset_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    assetCode: text("asset_code").notNull(),
    assetName: text("asset_name").notNull(),
    serial: text("serial"),
    modelId: uuid("model_id"),
    sourceLocationId: uuid("source_location_id").notNull(),
    quantity: integer("quantity").notNull(),
    returned: integer("returned").notNull().default(0),
    consumed: integer("consumed").notNull().default(0),
  },
  (row) => [
    primaryKey({ columns: [row.checkoutId, row.id] }),
    foreignKey({
      name: "asset_kit_checkout_lines_checkout_fk",
      columns: [row.siteId, row.checkoutId],
      foreignColumns: [assetKitCheckouts.siteId, assetKitCheckouts.id],
    }),
    foreignKey({
      name: "asset_kit_checkout_lines_requested_asset_fk",
      columns: [row.siteId, row.requestedAssetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_kit_checkout_lines_asset_fk",
      columns: [row.siteId, row.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_kit_checkout_lines_model_fk",
      columns: [row.siteId, row.modelId],
      foreignColumns: [assetModels.siteId, assetModels.id],
    }),
    foreignKey({
      name: "asset_kit_checkout_lines_source_fk",
      columns: [row.siteId, row.sourceLocationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    index("asset_kit_checkout_lines_site_asset_idx").on(row.siteId, row.assetId),
    check(
      "asset_kit_checkout_lines_mode_check",
      sql`(${row.mode} = 'individual' AND ${row.modelId} IS NULL AND ${row.quantity} = 1)
        OR (${row.mode} = 'model' AND ${row.modelId} IS NOT NULL AND ${row.quantity} = 1)
        OR (${row.mode} IN ('returnable_pool', 'consumable_pool') AND ${row.modelId} IS NULL
          AND ${row.serial} IS NULL)`,
    ),
    check(
      "asset_kit_checkout_lines_substitution_check",
      sql`${row.mode} = 'model' OR ${row.requestedAssetId} = ${row.assetId}`,
    ),
    check(
      "asset_kit_checkout_lines_qty_check",
      sql`${row.quantity} BETWEEN 1 AND 1000000 AND ${row.returned} >= 0 AND ${row.consumed} >= 0
        AND ${row.returned}::bigint + ${row.consumed} <= ${row.quantity}
        AND (${row.mode} = 'consumable_pool' OR ${row.consumed} = 0)`,
    ),
    check(
      "asset_kit_checkout_lines_snapshot_check",
      sql`length(btrim(${row.assetCode})) BETWEEN 1 AND 80
        AND length(btrim(${row.assetName})) BETWEEN 1 AND 120
        AND (${row.serial} IS NULL OR length(btrim(${row.serial})) BETWEEN 1 AND 80)`,
    ),
  ],
);

export const assetKitReturns = pgTable(
  "asset_kit_returns",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    kitId: uuid("kit_id").notNull(),
    checkoutId: uuid("checkout_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    at: instant("at").notNull(),
    condition: text("condition").$type<KitReturn["condition"]>().notNull(),
    note: text("note"),
    lines: jsonb("lines").$type<KitReturn["lines"]>().notNull(),
  },
  (row) => [
    foreignKey({
      name: "asset_kit_returns_checkout_fk",
      columns: [row.siteId, row.kitId, row.checkoutId],
      foreignColumns: [assetKitCheckouts.siteId, assetKitCheckouts.kitId, assetKitCheckouts.id],
    }),
    index("asset_kit_returns_site_checkout_idx").on(row.siteId, row.checkoutId),
    check(
      "asset_kit_returns_condition_check",
      sql`${row.condition} IN ('good', 'worn', 'damaged', 'needs_inspection')`,
    ),
    check("asset_kit_returns_note_check", sql`length(btrim(${row.note})) BETWEEN 1 AND 400`),
    check(
      "asset_kit_returns_lines_check",
      sql`CASE WHEN jsonb_typeof(${row.lines}) = 'array'
        THEN jsonb_array_length(${row.lines}) BETWEEN 1 AND 60 ELSE false END`,
    ),
  ],
);

export const assetKitActivity = pgTable(
  "asset_kit_activity",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    kitId: uuid("kit_id").notNull(),
    kind: text("kind").$type<KitActivity["kind"]>().notNull(),
    version: integer("version").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    at: instant("at").notNull(),
    note: text("note"),
    fromLocationId: uuid("from_location_id"),
    locationId: uuid("location_id").notNull(),
  },
  (row) => [
    unique("asset_kit_activity_version_key").on(row.kitId, row.version),
    index("asset_kit_activity_site_kit_idx").on(row.siteId, row.kitId),
    foreignKey({
      name: "asset_kit_activity_kit_fk",
      columns: [row.siteId, row.kitId],
      foreignColumns: [assetKits.siteId, assetKits.id],
    }),
    foreignKey({
      name: "asset_kit_activity_previous_location_fk",
      columns: [row.siteId, row.fromLocationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    foreignKey({
      name: "asset_kit_activity_location_fk",
      columns: [row.siteId, row.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      "asset_kit_activity_kind_check",
      sql`${row.kind} IN ('created', 'edited', 'moved', 'checked_out', 'returned')`,
    ),
    check("asset_kit_activity_version_check", sql`${row.version} > 0`),
    check("asset_kit_activity_note_check", sql`length(btrim(${row.note})) BETWEEN 1 AND 400`),
  ],
);

export const assetKitReceipts = pgTable(
  "asset_kit_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    siteId: uuid("site_id").notNull(),
    kitId: uuid("kit_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.actorId, row.requestId] }),
    foreignKey({
      name: "asset_kit_receipts_kit_fk",
      columns: [row.siteId, row.kitId],
      foreignColumns: [assetKits.siteId, assetKits.id],
    }),
    check("asset_kit_receipts_fingerprint_check", sql`${row.fingerprint} ~ '^[a-f0-9]{64}$'`),
  ],
);
