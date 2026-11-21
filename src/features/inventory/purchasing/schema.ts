import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { organizations } from "@/db/schema/organizations";
import { directoryLocations } from "@/features/locations/schema";
import type { CatalogUnit } from "../catalog/contracts";
import { inventoryItems, inventoryStockLimit } from "../schema";
import { inventorySupplierOffers } from "../sourcing/schema";
import {
  inventoryStockEvents,
  inventoryStockIncoming,
  inventoryStockPositions,
} from "../warehouse/schema";
import type { PurchaseOrder } from "./contracts";

const stockLimit = sql.raw(String(inventoryStockLimit));

export const purchaseOrders = pgTable(
  "inventory_purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id").notNull(),
    locationId: uuid("location_id").notNull(),
    supplierOrganizationId: uuid("supplier_organization_id")
      .notNull()
      .references(() => organizations.id),
    reference: text("reference").notNull(),
    expectedDate: date("expected_date", { mode: "string" }),
    status: text("status").$type<PurchaseOrder["status"]>().notNull().default("draft"),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
  },
  (table) => [
    unique("inventory_purchase_orders_id_site_key").on(table.id, table.siteId),
    uniqueIndex("inventory_purchase_orders_site_reference_key").on(
      table.siteId,
      sql`lower(${table.reference})`,
    ),
    index("inventory_purchase_orders_site_status_idx").on(table.siteId, table.status),
    foreignKey({
      name: "inventory_purchase_orders_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      "inventory_purchase_orders_reference_check",
      sql`length(${table.reference}) BETWEEN 1 AND 120 AND ${table.reference} = btrim(${table.reference})`,
    ),
    check("inventory_purchase_orders_version_check", sql`${table.version} >= 1`),
    check(
      "inventory_purchase_orders_status_check",
      sql`(${table.status} = 'draft' AND ${table.issuedAt} IS NULL AND ${table.cancellationReason} IS NULL)
        OR (${table.status} IN ('open', 'partial', 'received') AND ${table.issuedAt} IS NOT NULL AND ${table.cancellationReason} IS NULL)
        OR (${table.status} = 'cancelled' AND ${table.cancellationReason} IS NOT NULL
          AND length(btrim(${table.cancellationReason})) BETWEEN 1 AND 500)`,
    ),
  ],
);

export const purchaseOrderLines = pgTable(
  "inventory_purchase_order_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    siteId: uuid("site_id").notNull(),
    offerId: uuid("offer_id").notNull(),
    offerVersion: integer("offer_version").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    partCode: text("part_code").notNull(),
    partName: text("part_name").notNull(),
    revision: text("revision").notNull(),
    partNumber: text("part_number").notNull(),
    stockUnit: text("stock_unit").$type<CatalogUnit>().notNull(),
    trackable: boolean("trackable").notNull(),
    packQuantity: integer("pack_quantity").notNull(),
    packs: integer("packs").notNull(),
    orderedUnits: integer("ordered_units").notNull(),
    incomingId: uuid("incoming_id"),
  },
  (table) => [
    unique("inventory_purchase_lines_id_order_key").on(table.id, table.orderId),
    unique("inventory_purchase_lines_offer_key").on(table.orderId, table.offerId),
    unique("inventory_purchase_lines_incoming_key").on(table.incomingId),
    foreignKey({
      name: "inventory_purchase_lines_order_fk",
      columns: [table.orderId, table.siteId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.siteId],
    }),
    foreignKey({
      name: "inventory_purchase_lines_offer_fk",
      columns: [table.siteId, table.itemId, table.offerId],
      foreignColumns: [
        inventorySupplierOffers.siteId,
        inventorySupplierOffers.itemId,
        inventorySupplierOffers.id,
      ],
    }),
    foreignKey({
      name: "inventory_purchase_lines_incoming_fk",
      columns: [table.incomingId, table.itemId],
      foreignColumns: [inventoryStockIncoming.id, inventoryStockIncoming.itemId],
    }),
    check(
      "inventory_purchase_lines_quantity_check",
      sql`${table.offerVersion} >= 1 AND ${table.packQuantity} BETWEEN 1 AND ${stockLimit}
        AND ${table.packs} BETWEEN 1 AND 1000000 AND ${table.orderedUnits} BETWEEN 1 AND ${stockLimit}
        AND ${table.orderedUnits} = ${table.packQuantity}::bigint * ${table.packs}`,
    ),
  ],
);

export const purchaseOrderLineCosts = pgTable(
  "inventory_purchase_order_line_costs",
  {
    lineId: uuid("line_id")
      .primaryKey()
      .references(() => purchaseOrderLines.id),
    currency: text("currency").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    minPacks: integer("min_packs").notNull(),
  },
  (table) => [
    check(
      "inventory_purchase_line_costs_amount_check",
      sql`${table.currency} ~ '^[A-Z]{3}$' AND ${table.amount} BETWEEN 0 AND 99999999999999.9999
        AND ${table.minPacks} BETWEEN 1 AND 1000000`,
    ),
  ],
);

export const purchaseReceipts = pgTable(
  "inventory_purchase_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => purchaseOrders.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    supplierSlip: text("supplier_slip").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("inventory_purchase_receipts_id_order_key").on(table.id, table.orderId),
    unique("inventory_purchase_receipts_request_key").on(table.actorId, table.requestId),
    index("inventory_purchase_receipts_order_idx").on(table.orderId, table.createdAt),
    check(
      "inventory_purchase_receipts_slip_check",
      sql`length(${table.supplierSlip}) BETWEEN 1 AND 120 AND ${table.supplierSlip} = btrim(${table.supplierSlip})`,
    ),
  ],
);

export const purchaseReceiptLines = pgTable(
  "inventory_purchase_receipt_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptId: uuid("receipt_id").notNull(),
    orderId: uuid("order_id").notNull(),
    lineId: uuid("line_id").notNull(),
    quantity: integer("quantity").notNull(),
    lot: text("lot"),
    serial: text("serial"),
    expiryDate: date("expiry_date", { mode: "string" }),
    disposition: text("disposition").$type<"accepted" | "rejected">().notNull(),
    reason: text("reason"),
    positionId: uuid("position_id").references(() => inventoryStockPositions.id),
    eventId: uuid("event_id").references(() => inventoryStockEvents.id),
  },
  (table) => [
    index("inventory_purchase_receipt_lines_receipt_idx").on(table.receiptId),
    unique("inventory_purchase_receipt_lines_event_key").on(table.eventId),
    foreignKey({
      name: "inventory_purchase_receipt_lines_batch_fk",
      columns: [table.receiptId, table.orderId],
      foreignColumns: [purchaseReceipts.id, purchaseReceipts.orderId],
    }),
    foreignKey({
      name: "inventory_purchase_receipt_lines_order_line_fk",
      columns: [table.lineId, table.orderId],
      foreignColumns: [purchaseOrderLines.id, purchaseOrderLines.orderId],
    }),
    check(
      "inventory_purchase_receipt_lines_quantity_check",
      sql`${table.quantity} BETWEEN 1 AND ${stockLimit} AND (${table.serial} IS NULL OR ${table.quantity} = 1)`,
    ),
    check(
      "inventory_purchase_receipt_lines_disposition_check",
      sql`(${table.disposition} = 'accepted' AND ${table.positionId} IS NOT NULL AND ${table.eventId} IS NOT NULL)
        OR (${table.disposition} = 'rejected' AND ${table.positionId} IS NULL AND ${table.eventId} IS NULL
          AND ${table.reason} IS NOT NULL AND length(btrim(${table.reason})) BETWEEN 1 AND 500)`,
    ),
  ],
);
