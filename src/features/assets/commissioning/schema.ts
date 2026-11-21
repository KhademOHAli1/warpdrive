import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { inventoryProductionOutputs } from "@/features/inventory/production/buildSchema";
import { inventoryMovements } from "@/features/inventory/schema";
import {
  inventoryStockEvents,
  inventoryStockPositions,
} from "@/features/inventory/warehouse/schema";
import { directoryLocations } from "@/features/locations/schema";
import { assetEvents, assetRecords } from "../schema";

export const assetCommissioningHandoffs = pgTable(
  "asset_commissioning_handoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    positionId: uuid("position_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    itemId: uuid("item_id").notNull(),
    siteId: uuid("site_id").notNull(),
    locationId: uuid("location_id").notNull(),
    serial: text("serial").notNull(),
    lot: text("lot"),
    buildOutputId: uuid("build_output_id"),
    stockEventId: uuid("stock_event_id")
      .notNull()
      .references(() => inventoryStockEvents.id),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => inventoryMovements.id),
    assetEventId: uuid("asset_event_id")
      .notNull()
      .references(() => assetEvents.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique("asset_commissioning_position_key").on(table.positionId),
    unique("asset_commissioning_asset_key").on(table.assetId),
    unique("asset_commissioning_stock_event_key").on(table.stockEventId),
    unique("asset_commissioning_movement_key").on(table.movementId),
    unique("asset_commissioning_asset_event_key").on(table.assetEventId),
    unique("asset_commissioning_actor_request_key").on(table.actorId, table.requestId),
    foreignKey({
      name: "asset_commissioning_position_fk",
      columns: [table.positionId, table.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    foreignKey({
      name: "asset_commissioning_build_output_fk",
      columns: [table.buildOutputId, table.itemId],
      foreignColumns: [inventoryProductionOutputs.id, inventoryProductionOutputs.itemId],
    }),
    foreignKey({
      name: "asset_commissioning_asset_fk",
      columns: [table.siteId, table.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_commissioning_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check("asset_commissioning_serial_check", sql`length(btrim(${table.serial})) BETWEEN 1 AND 80`),
    check("asset_commissioning_lot_check", sql`length(btrim(${table.lot})) BETWEEN 1 AND 80`),
    check("asset_commissioning_fingerprint_check", sql`${table.fingerprint} ~ '^[a-f0-9]{64}$'`),
    check(
      "asset_commissioning_reason_check",
      sql`length(btrim(${table.reason})) BETWEEN 1 AND 400`,
    ),
  ],
);

export type AssetCommissioningHandoffRow = typeof assetCommissioningHandoffs.$inferSelect;
