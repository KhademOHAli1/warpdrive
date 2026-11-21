import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import type { CatalogUnit } from "../../catalog/contracts";
import { purchaseReceiptLines } from "../../purchasing/schema";
import { inventoryStockLimit } from "../../schema";
import { inventoryStockPositions, type WarehouseStockState } from "../schema";

export type ValuationSource = "override" | "purchase_receipt" | "unvalued";

export const inventoryValuationSnapshots = pgTable(
  "inventory_valuation_snapshots",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    label: text("label").notNull(),
    currency: text("currency").notNull(),
    capturedBy: uuid("captured_by")
      .notNull()
      .references(() => users.id),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    sealed: boolean("sealed").notNull().default(false),
  },
  (table) => [
    unique("inventory_valuation_snapshots_id_site_key").on(table.id, table.siteId),
    index("inventory_valuation_snapshots_site_time_idx").on(
      table.siteId,
      table.capturedAt,
      table.id,
    ),
    check(
      "inventory_valuation_snapshots_label_check",
      sql`${table.label} = btrim(${table.label}) AND length(${table.label}) BETWEEN 1 AND 120`,
    ),
    check("inventory_valuation_snapshots_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

const stockLimit = sql.raw(String(inventoryStockLimit));

export const inventoryValuationLines = pgTable(
  "inventory_valuation_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id").notNull(),
    siteId: uuid("site_id").notNull(),
    positionId: uuid("position_id").notNull(),
    itemId: uuid("item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    locationName: text("location_name").notNull(),
    code: text("part_code").notNull(),
    name: text("part_name").notNull(),
    revision: text("revision").notNull(),
    stockUnit: text("stock_unit").$type<CatalogUnit>().notNull(),
    quantity: integer("quantity").notNull(),
    reserved: integer("reserved").notNull(),
    stockState: text("stock_state").$type<WarehouseStockState>().notNull(),
    lot: text("lot"),
    serial: text("serial"),
    source: text("source").$type<ValuationSource>().notNull(),
    basisAmount: numeric("basis_amount", { precision: 18, scale: 4 }),
    basisPackQuantity: integer("basis_pack_quantity"),
    receiptLineId: uuid("receipt_line_id").references(() => purchaseReceiptLines.id),
    value: numeric("value", { precision: 38, scale: 4 }),
  },
  (table) => [
    unique("inventory_valuation_lines_position_key").on(table.snapshotId, table.positionId),
    foreignKey({
      name: "inventory_valuation_lines_snapshot_fk",
      columns: [table.snapshotId, table.siteId],
      foreignColumns: [inventoryValuationSnapshots.id, inventoryValuationSnapshots.siteId],
    }),
    foreignKey({
      name: "inventory_valuation_lines_position_fk",
      columns: [table.positionId, table.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    foreignKey({
      name: "inventory_valuation_lines_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      "inventory_valuation_lines_quantity_check",
      sql`${table.quantity} BETWEEN 1 AND ${stockLimit}
        AND ${table.reserved} BETWEEN 0 AND ${table.quantity}
        AND (${table.serial} IS NULL OR ${table.quantity} = 1)`,
    ),
    check(
      "inventory_valuation_lines_stock_state_check",
      sql`${table.stockState} IN ('available', 'quarantine', 'hold')`,
    ),
    check(
      "inventory_valuation_lines_basis_check",
      sql`(${table.source} = 'unvalued' AND ${table.basisAmount} IS NULL
          AND ${table.basisPackQuantity} IS NULL AND ${table.receiptLineId} IS NULL AND ${table.value} IS NULL)
        OR (${table.source} IN ('override', 'purchase_receipt') AND ${table.basisAmount} IS NOT NULL
          AND ${table.basisAmount} BETWEEN 0 AND 99999999999999.9999
          AND ${table.basisPackQuantity} IS NOT NULL AND ${table.basisPackQuantity} BETWEEN 1 AND ${stockLimit}
          AND ${table.value} IS NOT NULL AND ${table.value} >= 0
          AND ((${table.source} = 'override' AND ${table.receiptLineId} IS NULL AND ${table.basisPackQuantity} = 1)
            OR (${table.source} = 'purchase_receipt' AND ${table.receiptLineId} IS NOT NULL)))`,
    ),
  ],
);
