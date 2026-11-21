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
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { assetEvents, assetRecords } from "../schema";
import type { Custodian, CustodyAction, CustodyCondition, CustodyOutcome } from "./contracts";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const assetCustodians = pgTable(
  "asset_custodians",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    name: text("name").notNull(),
    kind: text("kind").$type<Custodian["kind"]>().notNull(),
    staffId: uuid("staff_id").references(() => users.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull(),
  },
  (row) => [
    unique("asset_custodians_site_identity_key").on(row.siteId, row.id),
    unique("asset_custodians_site_staff_key").on(row.siteId, row.staffId),
    check(
      "asset_custodians_name_check",
      sql`length(btrim(${row.name})) > 0 AND (${row.kind} = 'staff' OR length(btrim(${row.name})) <= 120)`,
    ),
    check(
      "asset_custodians_kind_check",
      sql`${row.kind} = 'staff' OR (${row.kind} = 'non_login' AND ${row.staffId} IS NULL)`,
    ),
    check("asset_custodians_version_check", sql`${row.version} > 0`),
  ],
);

export const assetCustodyHoldings = pgTable(
  "asset_custody_holdings",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    tracking: text("tracking").$type<"individual" | "returnable_pool">().notNull(),
    custodianId: uuid("custodian_id").notNull(),
    custodianName: text("custodian_name").notNull(),
    quantity: integer("quantity").notNull(),
    sourceLocationId: uuid("source_location_id"),
    locationId: uuid("location_id"),
    condition: text("condition").$type<CustodyCondition>().notNull(),
    assignedAt: instant("assigned_at").notNull(),
  },
  (row) => [
    index("asset_custody_holdings_site_asset_idx").on(row.siteId, row.assetId),
    index("asset_custody_holdings_site_holder_idx").on(row.siteId, row.custodianId),
    uniqueIndex("asset_custody_individual_key")
      .on(row.assetId)
      .where(sql`${row.tracking} = 'individual'`),
    foreignKey({
      name: "asset_custody_holdings_asset_fk",
      columns: [row.siteId, row.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_custody_holdings_custodian_fk",
      columns: [row.siteId, row.custodianId],
      foreignColumns: [assetCustodians.siteId, assetCustodians.id],
    }),
    foreignKey({
      name: "asset_custody_holdings_source_fk",
      columns: [row.siteId, row.sourceLocationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    foreignKey({
      name: "asset_custody_holdings_location_fk",
      columns: [row.siteId, row.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      "asset_custody_holdings_quantity_check",
      sql`(${row.tracking} = 'individual' AND ${row.quantity} = 1) OR (${row.tracking} = 'returnable_pool' AND ${row.quantity} BETWEEN 1 AND 1000000 AND ${row.sourceLocationId} IS NOT NULL)`,
    ),
    check(
      "asset_custody_holdings_condition_check",
      sql`${row.condition} IN ('good','worn','damaged','needs_inspection')`,
    ),
  ],
);

export const assetCustodyHistory = pgTable(
  "asset_custody_history",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => assetEvents.id),
    siteId: uuid("site_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    version: integer("version").notNull(),
    action: text("action").$type<CustodyAction>().notNull(),
    holdingId: uuid("holding_id").notNull(),
    destinationHoldingId: uuid("destination_holding_id"),
    fromCustodianId: uuid("from_custodian_id"),
    fromCustodianName: text("from_custodian_name"),
    toCustodianId: uuid("to_custodian_id"),
    toCustodianName: text("to_custodian_name"),
    quantity: integer("quantity").notNull(),
    sourceLocationId: uuid("source_location_id"),
    locationId: uuid("location_id"),
    condition: text("condition").$type<CustodyCondition>().notNull(),
    note: text("note"),
  },
  (row) => [
    unique("asset_custody_history_version_key").on(row.assetId, row.version),
    index("asset_custody_history_site_asset_idx").on(row.siteId, row.assetId),
    foreignKey({
      name: "asset_custody_history_asset_fk",
      columns: [row.siteId, row.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_custody_history_from_fk",
      columns: [row.siteId, row.fromCustodianId],
      foreignColumns: [assetCustodians.siteId, assetCustodians.id],
    }),
    foreignKey({
      name: "asset_custody_history_to_fk",
      columns: [row.siteId, row.toCustodianId],
      foreignColumns: [assetCustodians.siteId, assetCustodians.id],
    }),
    foreignKey({
      name: "asset_custody_history_source_fk",
      columns: [row.siteId, row.sourceLocationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    foreignKey({
      name: "asset_custody_history_location_fk",
      columns: [row.siteId, row.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check("asset_custody_history_version_check", sql`${row.version} > 1`),
    check("asset_custody_history_quantity_check", sql`${row.quantity} BETWEEN 1 AND 1000000`),
    check(
      "asset_custody_history_condition_check",
      sql`${row.condition} IN ('good','worn','damaged','needs_inspection')`,
    ),
    check("asset_custody_history_note_check", sql`length(btrim(${row.note})) BETWEEN 1 AND 400`),
    check(
      "asset_custody_history_transition_check",
      sql`
    ((${row.fromCustodianId} IS NULL) = (${row.fromCustodianName} IS NULL)) AND
    ((${row.toCustodianId} IS NULL) = (${row.toCustodianName} IS NULL)) AND (
      (${row.action} = 'assign' AND ${row.fromCustodianId} IS NULL AND ${row.toCustodianId} IS NOT NULL
        AND ${row.destinationHoldingId} IS NULL) OR
      (${row.action} = 'transfer' AND ${row.fromCustodianId} IS NOT NULL AND ${row.toCustodianId} IS NOT NULL
        AND ${row.fromCustodianId} <> ${row.toCustodianId} AND ${row.destinationHoldingId} IS NOT NULL
        AND ${row.destinationHoldingId} <> ${row.holdingId}) OR
      (${row.action} = 'return' AND ${row.fromCustodianId} IS NOT NULL AND ${row.toCustodianId} IS NULL
        AND ${row.destinationHoldingId} IS NULL)
    )`,
    ),
  ],
);

export const assetCustodianNotes = pgTable(
  "asset_custodian_notes",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    custodianId: uuid("custodian_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note").notNull(),
    at: instant("at").notNull(),
  },
  (row) => [
    index("asset_custodian_notes_site_holder_idx").on(row.siteId, row.custodianId),
    foreignKey({
      name: "asset_custodian_notes_holder_fk",
      columns: [row.siteId, row.custodianId],
      foreignColumns: [assetCustodians.siteId, assetCustodians.id],
    }),
    check("asset_custodian_notes_text_check", sql`length(btrim(${row.note})) BETWEEN 1 AND 400`),
  ],
);

export const assetCustodyReceipts = pgTable(
  "asset_custody_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    fingerprint: text("fingerprint").notNull(),
    outcomes: jsonb("outcomes").$type<CustodyOutcome[]>().notNull(),
    at: instant("at").notNull().defaultNow(),
  },
  (row) => [
    primaryKey({ columns: [row.actorId, row.requestId] }),
    check("asset_custody_receipts_fingerprint_check", sql`${row.fingerprint} ~ '^[a-f0-9]{64}$'`),
    check(
      "asset_custody_receipts_outcomes_check",
      sql`CASE WHEN jsonb_typeof(${row.outcomes}) = 'array' THEN jsonb_array_length(${row.outcomes}) <= 100 ELSE false END`,
    ),
  ],
);
