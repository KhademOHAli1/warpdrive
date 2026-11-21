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
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "@/db/schema/deals";
import { users } from "@/db/schema/identity";
import { internalProjectItems, internalProjectSettings } from "@/features/projects/schema";
import type { InventoryItem, InventoryOrder, InventoryTemplate } from "./contracts";

export const inventoryStockLimit = 1_000_000_000;

export type InventoryStockKind =
  | "receipt"
  | "order-reserve"
  | "materials-reserve"
  | "build-consume"
  | "build-output"
  | "shipment"
  | "cancel-release";

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    revision: text("revision").notNull(),
    kind: text("kind").$type<InventoryItem["kind"]>().notNull(),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
  },
  (table) => [
    unique("inventory_items_sku_key").on(table.sku),
    check("inventory_items_kind_check", sql`${table.kind} IN ('component', 'product')`),
    check("inventory_items_sku_check", sql`${table.sku} ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'`),
    check("inventory_items_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 120`),
    check("inventory_items_revision_check", sql`length(btrim(${table.revision})) BETWEEN 1 AND 20`),
    check(
      "inventory_items_balance_check",
      sql`${table.reserved} >= 0 AND ${table.reserved} <= ${table.onHand} AND ${table.onHand} <= ${sql.raw(String(inventoryStockLimit))}`,
    ),
  ],
);

export const inventoryBomLines = pgTable(
  "inventory_bom_lines",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({ name: "inventory_bom_lines_pkey", columns: [table.itemId, table.componentId] }),
    index("inventory_bom_lines_component_idx").on(table.componentId),
    check("inventory_bom_lines_quantity_check", sql`${table.quantity} BETWEEN 1 AND 1000000`),
    check("inventory_bom_lines_distinct_items_check", sql`${table.itemId} <> ${table.componentId}`),
  ],
);

export const inventoryTemplates = pgTable(
  "inventory_templates",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    configuredBy: uuid("configured_by")
      .notNull()
      .references(() => users.id),
    revision: integer("revision").notNull().default(1),
    steps: jsonb("steps").$type<InventoryTemplate["steps"]>().notNull(),
  },
  (table) => [
    foreignKey({
      name: "inventory_templates_project_fk",
      columns: [table.projectId],
      foreignColumns: [internalProjectSettings.projectId],
    }),
    index("inventory_templates_project_idx").on(table.projectId),
    check("inventory_templates_revision_check", sql`${table.revision} >= 1`),
    check(
      "inventory_templates_steps_check",
      sql`CASE WHEN jsonb_typeof(${table.steps}) = 'array' THEN jsonb_array_length(${table.steps}) BETWEEN 1 AND 10 ELSE false END`,
    ),
  ],
);

export const inventoryOrders = pgTable(
  "inventory_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: integer("quantity").notNull(),
    reserved: integer("reserved").notNull(),
    buildQuantity: integer("build_quantity").notNull(),
    status: text("status").$type<InventoryOrder["status"]>().notNull(),
    revision: integer("revision").notNull().default(1),
    projectId: uuid("project_id"),
    templateRevision: integer("template_revision"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "inventory_orders_project_fk",
      columns: [table.projectId],
      foreignColumns: [internalProjectSettings.projectId],
    }),
    unique("inventory_orders_id_project_key").on(table.id, table.projectId),
    index("inventory_orders_deal_created_idx").on(table.dealId, table.createdAt),
    index("inventory_orders_item_idx").on(table.itemId),
    index("inventory_orders_project_idx").on(table.projectId),
    check("inventory_orders_quantity_check", sql`${table.quantity} BETWEEN 1 AND 1000000`),
    check(
      "inventory_orders_balance_check",
      sql`${table.reserved} BETWEEN 0 AND ${table.quantity} AND ${table.buildQuantity} BETWEEN 0 AND ${table.quantity}`,
    ),
    check(
      "inventory_orders_status_check",
      sql`${table.status} IN ('awaiting_materials', 'in_production', 'ready', 'shipped', 'cancelled')`,
    ),
    check(
      "inventory_orders_status_reservation_check",
      sql`CASE
        WHEN ${table.status} = 'ready' THEN ${table.reserved} = ${table.quantity}
        WHEN ${table.status} IN ('awaiting_materials', 'in_production')
          THEN ${table.buildQuantity} > 0 AND ${table.reserved} = ${table.quantity} - ${table.buildQuantity}
        ELSE ${table.reserved} = 0
      END`,
    ),
    check(
      "inventory_orders_build_source_check",
      sql`CASE
        WHEN ${table.buildQuantity} = 0 THEN ${table.projectId} IS NULL AND ${table.templateRevision} IS NULL
        ELSE ${table.projectId} IS NOT NULL AND ${table.templateRevision} IS NOT NULL
      END`,
    ),
    check("inventory_orders_revision_check", sql`${table.revision} >= 1`),
    check("inventory_orders_template_revision_check", sql`${table.templateRevision} >= 1`),
  ],
);

export const inventoryOrderMaterials = pgTable(
  "inventory_order_materials",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => inventoryOrders.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_order_materials_pkey",
      columns: [table.orderId, table.componentId],
    }),
    index("inventory_order_materials_component_idx").on(table.componentId),
    check(
      "inventory_order_materials_quantity_check",
      sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(inventoryStockLimit))}`,
    ),
  ],
);

export const inventoryOrderTasks = pgTable(
  "inventory_order_tasks",
  {
    orderId: uuid("order_id").notNull(),
    projectId: uuid("project_id").notNull(),
    itemId: uuid("item_id").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ name: "inventory_order_tasks_pkey", columns: [table.orderId, table.position] }),
    foreignKey({
      name: "inventory_order_tasks_order_project_fk",
      columns: [table.orderId, table.projectId],
      foreignColumns: [inventoryOrders.id, inventoryOrders.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "inventory_order_tasks_item_project_fk",
      columns: [table.itemId, table.projectId],
      foreignColumns: [internalProjectItems.id, internalProjectItems.projectId],
    }),
    unique("inventory_order_tasks_item_key").on(table.itemId),
    check("inventory_order_tasks_position_check", sql`${table.position} >= 0`),
  ],
);

export const inventoryCommandReceipts = pgTable(
  "inventory_command_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "inventory_command_receipts_pkey",
      columns: [table.actorId, table.requestId],
    }),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    orderId: uuid("order_id").references(() => inventoryOrders.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    kind: text("kind").$type<InventoryStockKind>().notNull(),
    onHandDelta: integer("on_hand_delta").notNull(),
    reservedDelta: integer("reserved_delta").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_movements_item_created_idx").on(table.itemId, table.createdAt),
    index("inventory_movements_order_idx").on(table.orderId),
    index("inventory_movements_request_idx").on(table.actorId, table.requestId),
    check(
      "inventory_movements_kind_check",
      sql`${table.kind} IN ('receipt', 'order-reserve', 'materials-reserve', 'build-consume', 'build-output', 'shipment', 'cancel-release')`,
    ),
  ],
);
