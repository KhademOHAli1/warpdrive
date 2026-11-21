import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { organizations } from "@/db/schema/organizations";
import { directoryLocations } from "@/features/locations/schema";
import {
  inventoryItems,
  inventoryMovements,
  inventoryOrders,
  inventoryStockLimit,
} from "../schema";

export type WarehouseStockState = "available" | "quarantine" | "hold";
export type WarehouseLocationKind = "storage" | "structure" | "external";
export type WarehouseStockEventKind =
  | "receipt"
  | "reconcile"
  | "state"
  | "incoming-create"
  | "incoming-cancel"
  | "order-reserve"
  | "materials-reserve"
  | "build-consume"
  | "shipment"
  | "cancel-release";

export const inventoryStockLocationPolicies = pgTable(
  "inventory_stock_location_policies",
  {
    siteId: uuid("site_id").notNull(),
    locationId: uuid("location_id").notNull(),
    kind: text("kind").$type<WarehouseLocationKind>().notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_stock_location_policies_pkey",
      columns: [table.siteId, table.locationId],
    }),
    foreignKey({
      name: "inventory_stock_policy_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      "inventory_stock_policy_kind_check",
      sql`${table.kind} IN ('storage', 'structure', 'external')`,
    ),
  ],
);

export const inventoryStockPositions = pgTable(
  "inventory_stock_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    siteId: uuid("site_id").notNull(),
    locationId: uuid("location_id").notNull(),
    lot: text("lot"),
    serial: text("serial"),
    expiryDate: date("expiry_date", { mode: "string" }),
    state: text("state").$type<WarehouseStockState>().notNull().default("available"),
    ownerOrganizationId: uuid("owner_organization_id"),
    onHand: integer("on_hand").notNull(),
    reserved: integer("reserved").notNull().default(0),
  },
  (table) => [
    unique("inventory_stock_positions_id_item_key").on(table.id, table.itemId),
    uniqueIndex("inventory_stock_positions_serial_key")
      .on(table.itemId, table.serial)
      .where(sql`${table.serial} IS NOT NULL`),
    index("inventory_stock_positions_item_idx").on(table.itemId),
    index("inventory_stock_positions_site_location_idx").on(table.siteId, table.locationId),
    foreignKey({
      name: "inventory_stock_position_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    foreignKey({
      name: "inventory_stock_position_owner_fk",
      columns: [table.ownerOrganizationId],
      foreignColumns: [organizations.id],
    }),
    check(
      "inventory_stock_position_balance_check",
      sql`${table.reserved} BETWEEN 0 AND ${table.onHand} AND ${table.onHand} <= ${sql.raw(String(inventoryStockLimit))}`,
    ),
    check(
      "inventory_stock_position_lot_check",
      sql`${table.lot} = upper(btrim(${table.lot})) AND length(${table.lot}) BETWEEN 1 AND 80`,
    ),
    check(
      "inventory_stock_position_serial_check",
      sql`${table.serial} IS NULL OR (
        ${table.serial} = upper(btrim(${table.serial})) AND
        length(${table.serial}) BETWEEN 1 AND 80 AND ${table.onHand} <= 1
      )`,
    ),
    check(
      "inventory_stock_position_state_check",
      sql`${table.state} IN ('available', 'quarantine', 'hold')`,
    ),
    check(
      "inventory_stock_position_allocatable_check",
      sql`${table.reserved} = 0 OR (${table.state} = 'available' AND ${table.ownerOrganizationId} IS NULL)`,
    ),
  ],
);

export const inventoryStockIncoming = pgTable(
  "inventory_stock_incoming",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    siteId: uuid("site_id").notNull(),
    locationId: uuid("location_id").notNull(),
    ownerOrganizationId: uuid("owner_organization_id"),
    quantity: integer("quantity").notNull(),
    received: integer("received").notNull().default(0),
    cancelled: boolean("cancelled").notNull().default(false),
    expectedDate: date("expected_date", { mode: "string" }),
    reference: text("reference"),
  },
  (table) => [
    unique("inventory_stock_incoming_id_item_key").on(table.id, table.itemId),
    index("inventory_stock_incoming_item_idx").on(table.itemId),
    index("inventory_stock_incoming_site_location_idx").on(table.siteId, table.locationId),
    foreignKey({
      name: "inventory_stock_incoming_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    foreignKey({
      name: "inventory_stock_incoming_owner_fk",
      columns: [table.ownerOrganizationId],
      foreignColumns: [organizations.id],
    }),
    check(
      "inventory_stock_incoming_quantity_check",
      sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(inventoryStockLimit))} AND ${table.received} BETWEEN 0 AND ${table.quantity}`,
    ),
    check(
      "inventory_stock_incoming_reference_check",
      sql`length(btrim(${table.reference})) BETWEEN 1 AND 120`,
    ),
  ],
);

export const inventoryStockAllocations = pgTable(
  "inventory_stock_allocations",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => inventoryOrders.id),
    positionId: uuid("position_id").notNull(),
    itemId: uuid("item_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_stock_allocations_pkey",
      columns: [table.orderId, table.positionId],
    }),
    index("inventory_stock_allocations_order_item_idx").on(table.orderId, table.itemId),
    index("inventory_stock_allocations_position_idx").on(table.positionId),
    foreignKey({
      name: "inventory_stock_allocation_position_fk",
      columns: [table.positionId, table.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    check(
      "inventory_stock_allocation_quantity_check",
      sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(inventoryStockLimit))}`,
    ),
  ],
);

export const inventoryStockEvents = pgTable(
  "inventory_stock_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    positionId: uuid("position_id"),
    sourcePositionId: uuid("source_position_id"),
    incomingId: uuid("incoming_id"),
    movementId: uuid("movement_id"),
    orderId: uuid("order_id").references(() => inventoryOrders.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    kind: text("kind").$type<WarehouseStockEventKind>().notNull(),
    onHandDelta: integer("on_hand_delta").notNull().default(0),
    reservedDelta: integer("reserved_delta").notNull().default(0),
    incomingDelta: integer("incoming_delta").notNull().default(0),
    previousState: text("previous_state").$type<WarehouseStockState>(),
    state: text("state").$type<WarehouseStockState>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_stock_events_item_time_idx").on(table.itemId, table.createdAt),
    index("inventory_stock_events_position_idx").on(table.positionId),
    index("inventory_stock_events_source_position_idx").on(table.sourcePositionId),
    index("inventory_stock_events_incoming_idx").on(table.incomingId),
    index("inventory_stock_events_movement_idx").on(table.movementId),
    index("inventory_stock_events_actor_request_idx").on(table.actorId, table.requestId),
    foreignKey({
      name: "inventory_stock_event_position_fk",
      columns: [table.positionId, table.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    foreignKey({
      name: "inventory_stock_event_source_position_fk",
      columns: [table.sourcePositionId, table.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    foreignKey({
      name: "inventory_stock_event_incoming_fk",
      columns: [table.incomingId, table.itemId],
      foreignColumns: [inventoryStockIncoming.id, inventoryStockIncoming.itemId],
    }),
    foreignKey({
      name: "inventory_stock_event_movement_fk",
      columns: [table.movementId],
      foreignColumns: [inventoryMovements.id],
    }),
    check(
      "inventory_stock_event_kind_check",
      sql`${table.kind} IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release')`,
    ),
    check(
      "inventory_stock_event_previous_state_check",
      sql`${table.previousState} IN ('available', 'quarantine', 'hold')`,
    ),
    check(
      "inventory_stock_event_state_check",
      sql`${table.state} IN ('available', 'quarantine', 'hold')`,
    ),
  ],
);
