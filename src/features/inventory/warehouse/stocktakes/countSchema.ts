import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { organizations } from "@/db/schema/organizations";
import { directoryLocations } from "@/features/locations/schema";
import { inventoryStockLimit } from "../../schema";
import { inventoryStockEvents, inventoryStockPositions, type WarehouseStockState } from "../schema";

const stockLimit = sql.raw(String(inventoryStockLimit));

export const inventoryStocktakes = pgTable(
  "inventory_stocktakes",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    locationId: uuid("location_id").notNull(),
    locationName: text("location_name").notNull(),
    note: text("note").notNull(),
    status: text("status").$type<"draft" | "reconciled" | "cancelled">().notNull().default("draft"),
    version: integer("version").notNull().default(1),
    binEventSequence: bigint("bin_event_sequence", { mode: "bigint" }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
  },
  (table) => [
    index("inventory_stocktakes_site_history_idx").on(table.siteId, table.createdAt, table.id),
    foreignKey({
      name: "inventory_stocktakes_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check("inventory_stocktakes_version_check", sql`${table.version} > 0`),
    check("inventory_stocktakes_sequence_check", sql`${table.binEventSequence} >= 0`),
    check("inventory_stocktakes_note_check", sql`length(${table.note}) <= 500`),
    check(
      "inventory_stocktakes_state_check",
      sql`(${table.status} = 'draft' AND ${table.closedBy} IS NULL AND ${table.closedAt} IS NULL
        AND ${table.cancellationReason} IS NULL)
        OR (${table.status} = 'reconciled' AND ${table.closedBy} IS NOT NULL AND ${table.closedAt} IS NOT NULL
          AND ${table.cancellationReason} IS NULL)
        OR (${table.status} = 'cancelled' AND ${table.closedBy} IS NOT NULL AND ${table.closedAt} IS NOT NULL
          AND ${table.cancellationReason} IS NOT NULL
          AND length(btrim(${table.cancellationReason})) BETWEEN 1 AND 500)`,
    ),
  ],
);

export const inventoryStocktakeLines = pgTable(
  "inventory_stocktake_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stocktakeId: uuid("stocktake_id")
      .notNull()
      .references(() => inventoryStocktakes.id),
    positionId: uuid("position_id").notNull(),
    itemId: uuid("item_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    revision: text("revision").notNull(),
    lot: text("lot"),
    serial: text("serial"),
    expiryDate: date("expiry_date", { mode: "string" }),
    ownerOrganizationId: uuid("owner_organization_id").references(() => organizations.id),
    state: text("state").$type<WarehouseStockState>().notNull(),
    expectedOnHand: integer("expected_on_hand").notNull(),
    reserved: integer("reserved").notNull(),
    eventSequence: bigint("event_sequence", { mode: "bigint" }).notNull(),
    countedQuantity: integer("counted_quantity"),
    reason: text("reason"),
    countedBy: uuid("counted_by").references(() => users.id),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    correctionEventId: uuid("correction_event_id").references(() => inventoryStockEvents.id),
  },
  (table) => [
    unique("inventory_stocktake_lines_position_key").on(table.stocktakeId, table.positionId),
    unique("inventory_stocktake_lines_correction_key").on(table.correctionEventId),
    foreignKey({
      name: "inventory_stocktake_lines_position_fk",
      columns: [table.positionId, table.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    check(
      "inventory_stocktake_lines_capture_check",
      sql`${table.expectedOnHand} BETWEEN 1 AND ${stockLimit}
        AND ${table.reserved} BETWEEN 0 AND ${table.expectedOnHand}
        AND ${table.eventSequence} >= 0
        AND ${table.state} IN ('available', 'quarantine', 'hold')
        AND (${table.serial} IS NULL OR ${table.expectedOnHand} = 1)`,
    ),
    check(
      "inventory_stocktake_lines_observation_check",
      sql`(${table.countedQuantity} IS NULL AND ${table.countedBy} IS NULL AND ${table.countedAt} IS NULL
          AND ${table.reason} IS NULL AND ${table.correctionEventId} IS NULL)
        OR (${table.countedQuantity} IS NOT NULL AND ${table.countedBy} IS NOT NULL AND ${table.countedAt} IS NOT NULL
          AND ${table.countedQuantity} BETWEEN 0 AND ${stockLimit}
          AND (${table.serial} IS NULL OR ${table.countedQuantity} <= 1)
          AND (${table.reason} IS NULL OR length(btrim(${table.reason})) BETWEEN 1 AND 500)
          AND (${table.countedQuantity} <> ${table.expectedOnHand} OR ${table.correctionEventId} IS NULL)
          AND (${table.countedQuantity} = ${table.expectedOnHand} OR ${table.reason} IS NOT NULL))`,
    ),
  ],
);
