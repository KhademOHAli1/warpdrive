import { sql } from "drizzle-orm";
import {
  check,
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
import { users } from "@/db/schema/identity";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { salesShipmentLines, salesShipments } from "../sales/schema";
import { inventoryItems } from "../schema";
import { inventoryStockEvents, inventoryStockPositions } from "../warehouse/schema";
import type {
  ReturnCharge,
  ReturnCommand,
  ReturnCommercialKind,
  ReturnCondition,
  ReturnDispositionKind,
  ReturnPhysicalStatus,
  ReturnStatus,
} from "./contracts";

export const returnCases = pgTable(
  "inventory_return_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id").notNull(),
    orderId: uuid("order_id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    reference: text("reference").notNull(),
    status: text("status").$type<ReturnStatus>().notNull().default("draft"),
    version: integer("version").notNull().default(1),
    note: text("note"),
    charges: jsonb("charges").$type<ReturnCharge[]>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
  },
  (t) => [
    unique("inventory_return_reference_key").on(t.siteId, t.reference),
    unique("inventory_return_case_source_key").on(t.id, t.shipmentId, t.orderId),
    index("inventory_return_case_ship_idx").on(t.shipmentId),
    index("inventory_return_case_site_idx").on(t.siteId, t.createdAt.desc()),
    foreignKey({
      name: "inventory_return_case_source_fk",
      columns: [t.shipmentId, t.orderId],
      foreignColumns: [salesShipments.id, salesShipments.orderId],
    }),
    check(
      "inventory_return_case_status_check",
      sql`${t.status} IN ('draft','issued','onHold','completed','cancelled') AND ${t.version}>0 AND
    (CASE ${t.status} WHEN 'draft' THEN ${t.issuedAt} IS NULL WHEN 'cancelled' THEN true ELSE ${t.issuedAt} IS NOT NULL END)`,
    ),
    check("inventory_return_case_reference_check", sql`length(${t.reference}) BETWEEN 1 AND 80`),
  ],
);

export const returnLines = pgTable(
  "inventory_return_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull(),
    orderId: uuid("order_id").notNull(),
    shipmentId: uuid("shipment_id").notNull(),
    shipmentLineId: uuid("shipment_line_id").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: integer("quantity").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [
    unique("inventory_return_line_source_key").on(t.caseId, t.shipmentLineId),
    unique("inventory_return_line_receipt_key").on(t.id, t.caseId, t.shipmentLineId, t.itemId),
    index("inventory_return_line_ship_idx").on(t.shipmentLineId, t.caseId),
    foreignKey({
      name: "inventory_return_line_case_fk",
      columns: [t.caseId, t.shipmentId, t.orderId],
      foreignColumns: [returnCases.id, returnCases.shipmentId, returnCases.orderId],
    }),
    foreignKey({
      name: "inventory_return_line_shipment_fk",
      columns: [t.shipmentLineId, t.shipmentId, t.orderId],
      foreignColumns: [
        salesShipmentLines.id,
        salesShipmentLines.shipmentId,
        salesShipmentLines.orderId,
      ],
    }),
    check(
      "inventory_return_line_values_check",
      sql`${t.quantity} BETWEEN 1 AND 1000000 AND length(${t.reason}) BETWEEN 1 AND 400`,
    ),
  ],
);

export const returnReceipts = pgTable(
  "inventory_return_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lineId: uuid("line_id").notNull(),
    caseId: uuid("case_id").notNull(),
    shipmentLineId: uuid("shipment_line_id").notNull(),
    itemId: uuid("item_id").notNull(),
    positionId: uuid("position_id").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => directoryLocations.id),
    quantity: integer("quantity").notNull(),
    condition: text("condition").$type<ReturnCondition>().notNull(),
    note: text("note"),
    eventId: uuid("event_id")
      .notNull()
      .references(() => inventoryStockEvents.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    physical: text("physical").$type<ReturnPhysicalStatus>().notNull().default("quarantine"),
  },
  (t) => [
    unique("inventory_return_receipt_event_key").on(t.eventId),
    uniqueIndex("inventory_return_open_position_key")
      .on(t.positionId)
      .where(sql`${t.physical} IN ('quarantine','repair')`),
    index("inventory_return_receipt_position_idx").on(t.positionId, t.physical),
    index("inventory_return_receipt_line_idx").on(t.lineId),
    index("inventory_return_receipt_ship_idx").on(t.shipmentLineId),
    foreignKey({
      name: "inventory_return_receipt_line_fk",
      columns: [t.lineId, t.caseId, t.shipmentLineId, t.itemId],
      foreignColumns: [
        returnLines.id,
        returnLines.caseId,
        returnLines.shipmentLineId,
        returnLines.itemId,
      ],
    }),
    foreignKey({
      name: "inventory_return_receipt_stock_fk",
      columns: [t.positionId, t.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    check(
      "inventory_return_receipt_values_check",
      sql`${t.quantity} BETWEEN 1 AND 1000000 AND ${t.condition} IN ('unopened','used','damaged','unknown') AND ${t.physical} IN ('quarantine','repair','restocked','scrapped')`,
    ),
  ],
);

export const returnDispositions = pgTable(
  "inventory_return_dispositions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => returnReceipts.id),
    kind: text("kind").$type<ReturnDispositionKind>().notNull(),
    reason: text("reason").notNull(),
    eventId: uuid("event_id").references(() => inventoryStockEvents.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_return_disposition_kind_key").on(t.receiptId, t.kind),
    unique("inventory_return_disposition_event_key").on(t.eventId),
    check(
      "inventory_return_disposition_check",
      sql`${t.kind} IN ('restock','repair','scrap') AND (${t.kind}='repair')=(${t.eventId} IS NULL) AND length(${t.reason}) BETWEEN 1 AND 400`,
    ),
  ],
);

export const returnCommercial = pgTable(
  "inventory_return_commercial",
  {
    receiptId: uuid("receipt_id")
      .primaryKey()
      .references(() => returnReceipts.id),
    kind: text("kind").$type<ReturnCommercialKind>().notNull(),
    currency: text("currency").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }),
    reference: text("reference"),
    reason: text("reason").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "inventory_return_commercial_check",
      sql`${t.kind} IN ('refund','replacement','none') AND length(${t.reason}) BETWEEN 1 AND 400 AND
   (CASE WHEN ${t.kind}='refund' THEN ${t.amount} IS NOT NULL AND ${t.amount}>0 ELSE ${t.amount} IS NULL END)`,
    ),
  ],
);

export const returnHistory = pgTable(
  "inventory_return_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => returnCases.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    type: text("type").$type<ReturnCommand["type"]>().notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_return_history_case_idx").on(t.caseId, t.createdAt.desc())],
);

export type ReturnCaseRow = typeof returnCases.$inferSelect;
export type ReturnLineRow = typeof returnLines.$inferSelect;
