import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "@/db/schema/deals";
import { users } from "@/db/schema/identity";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import type { CatalogUnit } from "../catalog/contracts";
import { inventoryProductionOutputs } from "../production/buildSchema";
import { inventoryItems } from "../schema";
import { inventoryStockEvents, inventoryStockPositions } from "../warehouse/schema";
import type { SalesCharge, SalesOrderStatus, SalesShipmentStatus } from "./contracts";

export const salesOrders = pgTable(
  "inventory_sales_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    reference: text("reference").notNull(),
    status: text("status").$type<SalesOrderStatus>().notNull().default("draft"),
    version: integer("version").notNull().default(1),
    dueDate: date("due_date", { mode: "string" }),
    dealName: text("deal_name").notNull(),
    customerName: text("customer_name"),
    recipient: text("recipient").notNull(),
    address: text("address").notNull(),
    currency: text("currency").notNull(),
    charges: jsonb("charges").$type<SalesCharge[]>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    issuedBy: uuid("issued_by").references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
  },
  (t) => [
    unique("inventory_sales_site_reference_key").on(t.siteId, t.reference),
    index("inventory_sales_deal_idx").on(t.dealId, t.createdAt.desc()),
    index("inventory_sales_site_due_idx").on(t.siteId, t.dueDate, t.createdAt.desc()),
    check(
      "inventory_sales_order_status_check",
      sql`${t.status} IN ('draft','issued','shipped','cancelled') AND ${t.version}>0 AND
    (${t.issuedAt} IS NULL) = (${t.issuedBy} IS NULL) AND
    (${t.status} NOT IN ('issued','shipped') OR ${t.issuedAt} IS NOT NULL) AND
    (${t.status} <> 'draft' OR ${t.issuedAt} IS NULL) AND
    (CASE WHEN ${t.status}='cancelled' THEN ${t.cancelledBy} IS NOT NULL AND ${t.cancelledAt} IS NOT NULL AND ${t.cancellationReason} IS NOT NULL
          ELSE ${t.cancelledBy} IS NULL AND ${t.cancelledAt} IS NULL AND ${t.cancellationReason} IS NULL END)`,
    ),
    check(
      "inventory_sales_delivery_check",
      sql`length(${t.reference}) BETWEEN 1 AND 80 AND length(${t.recipient}) BETWEEN 1 AND 180 AND length(${t.address}) BETWEEN 1 AND 1000 AND ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const salesOrderLines = pgTable(
  "inventory_sales_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: integer("quantity").notNull(),
    shipped: integer("shipped").notNull().default(0),
    partCode: text("part_code").notNull(),
    partName: text("part_name").notNull(),
    partRevision: text("part_revision").notNull(),
    stockUnit: text("stock_unit").$type<CatalogUnit>().notNull(),
    note: text("note"),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [
    unique("inventory_sales_line_identity_key").on(t.id, t.orderId, t.itemId),
    unique("inventory_sales_line_sequence_key").on(t.orderId, t.ordinal),
    index("inventory_sales_line_item_idx").on(t.itemId, t.orderId),
    check(
      "inventory_sales_line_quantity_check",
      sql`${t.quantity} BETWEEN 1 AND 1000000 AND ${t.shipped} BETWEEN 0 AND ${t.quantity} AND ${t.ordinal} >= 0 AND ${t.unitPrice} >= 0`,
    ),
  ],
);

export const salesAllocations = pgTable(
  "inventory_sales_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    lineId: uuid("line_id").notNull(),
    itemId: uuid("item_id").notNull(),
    positionId: uuid("position_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    unique("inventory_sales_allocation_line_position_key").on(t.lineId, t.positionId),
    index("inventory_sales_allocation_order_idx").on(t.orderId),
    index("inventory_sales_allocation_position_idx").on(t.positionId),
    foreignKey({
      name: "inventory_sales_allocation_line_fk",
      columns: [t.lineId, t.orderId, t.itemId],
      foreignColumns: [salesOrderLines.id, salesOrderLines.orderId, salesOrderLines.itemId],
    }),
    foreignKey({
      name: "inventory_sales_allocation_position_fk",
      columns: [t.positionId, t.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    check("inventory_sales_allocation_qty_check", sql`${t.quantity} BETWEEN 1 AND 1000000`),
  ],
);

export const salesShipments = pgTable(
  "inventory_sales_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id),
    reference: text("reference").notNull(),
    status: text("status").$type<SalesShipmentStatus>().notNull().default("draft"),
    carrier: text("carrier"),
    tracking: text("tracking"),
    shippedOn: date("shipped_on", { mode: "string" }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    unique("inventory_sales_shipment_order_key").on(t.id, t.orderId),
    unique("inventory_sales_shipment_reference_key").on(t.orderId, t.reference),
    uniqueIndex("inventory_sales_one_open_shipment").on(t.orderId).where(sql`${t.status}='draft'`),
    check(
      "inventory_sales_shipment_status_check",
      sql`${t.status} IN ('draft','shipped','cancelled') AND
    (CASE WHEN ${t.status}='shipped' THEN ${t.postedAt} IS NOT NULL AND ${t.postedBy} IS NOT NULL AND ${t.shippedOn} IS NOT NULL AND ${t.carrier} IS NOT NULL
      ELSE ${t.postedAt} IS NULL AND ${t.postedBy} IS NULL AND ${t.shippedOn} IS NULL AND ${t.carrier} IS NULL AND ${t.tracking} IS NULL END)`,
    ),
  ],
);

export const salesShipmentLines = pgTable(
  "inventory_sales_shipment_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    shipmentId: uuid("shipment_id").notNull(),
    lineId: uuid("line_id").notNull(),
    itemId: uuid("item_id").notNull(),
    positionId: uuid("position_id").notNull(),
    allocationId: uuid("allocation_id"),
    quantity: integer("quantity").notNull(),
    checked: boolean("checked").notNull().default(false),
    lot: text("lot"),
    serial: text("serial"),
    locationId: uuid("location_id")
      .notNull()
      .references(() => directoryLocations.id),
    buildOutputId: uuid("build_output_id").references(() => inventoryProductionOutputs.id),
    eventId: uuid("event_id").references(() => inventoryStockEvents.id),
  },
  (t) => [
    unique("inventory_sales_packing_line_identity_key").on(t.id, t.shipmentId, t.orderId),
    unique("inventory_sales_packing_event_key").on(t.eventId),
    unique("inventory_sales_packing_allocation_key").on(t.shipmentId, t.allocationId),
    index("inventory_sales_packing_serial_idx").on(t.itemId, t.serial),
    index("inventory_sales_packing_line_idx").on(t.lineId),
    foreignKey({
      name: "inventory_sales_packing_order_fk",
      columns: [t.shipmentId, t.orderId],
      foreignColumns: [salesShipments.id, salesShipments.orderId],
    }),
    foreignKey({
      name: "inventory_sales_packing_line_fk",
      columns: [t.lineId, t.orderId, t.itemId],
      foreignColumns: [salesOrderLines.id, salesOrderLines.orderId, salesOrderLines.itemId],
    }),
    foreignKey({
      name: "inventory_sales_packing_position_fk",
      columns: [t.positionId, t.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    check(
      "inventory_sales_packing_qty_check",
      sql`${t.quantity} BETWEEN 1 AND 1000000 AND (${t.serial} IS NULL OR ${t.quantity}=1) AND (${t.eventId} IS NULL OR ${t.checked})`,
    ),
  ],
);

export const salesAllocationEvents = pgTable(
  "inventory_sales_allocation_events",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => inventoryStockEvents.id),
    orderId: uuid("order_id").notNull(),
    lineId: uuid("line_id").notNull(),
    allocationId: uuid("allocation_id").notNull(),
    positionId: uuid("position_id").notNull(),
    itemId: uuid("item_id").notNull(),
  },
  (t) => [
    index("inventory_sales_allocation_events_order_idx").on(t.orderId, t.lineId),
    foreignKey({
      name: "inventory_sales_alloc_event_line_fk",
      columns: [t.lineId, t.orderId, t.itemId],
      foreignColumns: [salesOrderLines.id, salesOrderLines.orderId, salesOrderLines.itemId],
    }),
    foreignKey({
      name: "inventory_sales_alloc_event_position_fk",
      columns: [t.positionId, t.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
  ],
);

export const salesPackingChecks = pgTable(
  "inventory_sales_packing_checks",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    shipmentId: uuid("shipment_id").notNull(),
    shipmentLineId: uuid("shipment_line_id").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    checked: boolean("checked").notNull(),
    scan: text("scan"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_sales_packing_checks_line_idx").on(t.shipmentLineId, t.createdAt),
    foreignKey({
      name: "inventory_sales_packing_check_line_fk",
      columns: [t.shipmentLineId, t.shipmentId, t.orderId],
      foreignColumns: [
        salesShipmentLines.id,
        salesShipmentLines.shipmentId,
        salesShipmentLines.orderId,
      ],
    }),
    check(
      "inventory_sales_packing_scan_check",
      sql`${t.scan} IS NULL OR (${t.checked} AND length(${t.scan}) BETWEEN 1 AND 120)`,
    ),
  ],
);

export type SalesOrderRow = typeof salesOrders.$inferSelect;
export type SalesLineRow = typeof salesOrderLines.$inferSelect;
