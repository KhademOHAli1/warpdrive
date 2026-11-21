import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directoryLocations } from "@/features/locations/schema";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "../production/buildSchema";
import { inventoryProductionMaterials } from "../production/materialSchema";
import { purchaseOrderLines, purchaseReceiptLines } from "../purchasing/schema";
import { inventoryStockEvents, inventoryStockPositions } from "../warehouse/schema";

export const inventorySubcontracts = pgTable(
  "inventory_subcontracts",
  {
    buildId: uuid("build_id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    lineId: uuid("line_id").notNull(),
    siteId: uuid("site_id").notNull(),
    supplierBinId: uuid("supplier_bin_id").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_subcontract_line_key").on(t.lineId),
    index("inventory_subcontract_order_idx").on(t.orderId),
    index("inventory_subcontract_site_vendor_idx").on(t.siteId, t.supplierBinId),
    foreignKey({
      name: "inventory_subcontract_build_fk",
      columns: [t.buildId, t.siteId],
      foreignColumns: [inventoryProductionBuilds.id, inventoryProductionBuilds.siteId],
    }),
    foreignKey({
      name: "inventory_subcontract_line_fk",
      columns: [t.lineId, t.orderId],
      foreignColumns: [purchaseOrderLines.id, purchaseOrderLines.orderId],
    }),
    foreignKey({
      name: "inventory_subcontract_supplier_bin_fk",
      columns: [t.siteId, t.supplierBinId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
  ],
);

export const inventorySubcontractMaterials = pgTable(
  "inventory_subcontract_materials",
  {
    buildId: uuid("build_id")
      .notNull()
      .references(() => inventorySubcontracts.buildId),
    materialId: uuid("material_id")
      .notNull()
      .references(() => inventoryProductionMaterials.id),
  },
  (t) => [
    primaryKey({ name: "inventory_subcontract_material_pk", columns: [t.buildId, t.materialId] }),
  ],
);

export const inventorySubcontractDispatches = pgTable(
  "inventory_subcontract_dispatches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildId: uuid("build_id").notNull(),
    materialId: uuid("material_id").notNull(),
    itemId: uuid("item_id").notNull(),
    sourcePositionId: uuid("source_position_id").notNull(),
    sourceLocationId: uuid("source_location_id")
      .notNull()
      .references(() => directoryLocations.id),
    vendorPositionId: uuid("vendor_position_id").notNull(),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => inventoryStockEvents.id),
    dispatchEventId: uuid("dispatch_event_id")
      .notNull()
      .references(() => inventoryStockEvents.id),
    quantity: integer("quantity").notNull(),
    consumed: integer("consumed").notNull().default(0),
    returned: integer("returned").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_subcontract_dispatch_event_key").on(t.dispatchEventId),
    unique("inventory_subcontract_dispatch_source_event_key").on(t.sourceEventId),
    index("inventory_subcontract_dispatch_vendor_idx").on(t.vendorPositionId),
    index("inventory_subcontract_dispatch_material_idx").on(t.buildId, t.materialId),
    foreignKey({
      name: "inventory_subcontract_dispatch_material_fk",
      columns: [t.buildId, t.materialId],
      foreignColumns: [
        inventorySubcontractMaterials.buildId,
        inventorySubcontractMaterials.materialId,
      ],
    }),
    foreignKey({
      name: "inventory_subcontract_dispatch_part_fk",
      columns: [t.materialId, t.itemId],
      foreignColumns: [inventoryProductionMaterials.id, inventoryProductionMaterials.itemId],
    }),
    foreignKey({
      name: "inventory_subcontract_dispatch_origin_fk",
      columns: [t.sourcePositionId, t.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    foreignKey({
      name: "inventory_subcontract_dispatch_vendor_fk",
      columns: [t.vendorPositionId, t.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    check(
      "inventory_subcontract_dispatch_balance",
      sql`${t.quantity} BETWEEN 1 AND 1000000000 AND ${t.returned} >= 0 AND ${t.consumed} >= 0 AND ${t.returned} + ${t.consumed} <= ${t.quantity}`,
    ),
  ],
);

export const inventorySubcontractReturns = pgTable(
  "inventory_subcontract_returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dispatchId: uuid("dispatch_id")
      .notNull()
      .references(() => inventorySubcontractDispatches.id),
    quantity: integer("quantity").notNull(),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => inventoryStockEvents.id),
    returnEventId: uuid("return_event_id")
      .notNull()
      .references(() => inventoryStockEvents.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_subcontract_return_event_key").on(t.returnEventId),
    unique("inventory_subcontract_return_source_key").on(t.sourceEventId),
    index("inventory_subcontract_return_dispatch_idx").on(t.dispatchId),
    check("inventory_subcontract_return_qty_check", sql`${t.quantity} BETWEEN 1 AND 1000000000`),
  ],
);

export const inventorySubcontractReceipts = pgTable(
  "inventory_subcontract_receipts",
  {
    outputId: uuid("output_id")
      .primaryKey()
      .references(() => inventoryProductionOutputs.id),
    buildId: uuid("build_id")
      .notNull()
      .references(() => inventorySubcontracts.buildId),
    receiptLineId: uuid("receipt_line_id")
      .notNull()
      .references(() => purchaseReceiptLines.id),
    positionId: uuid("position_id")
      .notNull()
      .references(() => inventoryStockPositions.id),
    orderId: uuid("order_id").notNull(),
  },
  (t) => [
    unique("inventory_subcontract_receipt_purchase_key").on(t.receiptLineId),
    unique("inventory_subcontract_receipt_position_key").on(t.positionId),
    index("inventory_subcontract_receipt_build_idx").on(t.buildId),
  ],
);

export const inventorySubcontractConsumptions = pgTable(
  "inventory_subcontract_consumptions",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => inventoryStockEvents.id),
    outputId: uuid("output_id")
      .notNull()
      .references(() => inventorySubcontractReceipts.outputId),
    dispatchId: uuid("dispatch_id")
      .notNull()
      .references(() => inventorySubcontractDispatches.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    index("inventory_subcontract_consumption_output_idx").on(t.outputId),
    index("inventory_subcontract_consumption_dispatch_idx").on(t.dispatchId),
    check(
      "inventory_subcontract_consumption_qty_check",
      sql`${t.quantity} BETWEEN 1 AND 1000000000`,
    ),
  ],
);

export type Subcontract = typeof inventorySubcontracts.$inferSelect;
