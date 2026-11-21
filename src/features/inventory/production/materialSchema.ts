import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { internalProjectItems } from "@/features/projects/schema";
import type { CatalogUnit } from "../catalog/contracts";
import { inventoryProductReleases } from "../releases/schema";
import { inventoryItems } from "../schema";
import { inventoryStockEvents, inventoryStockPositions } from "../warehouse/schema";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "./buildSchema";
import type { ProductionCommand } from "./contracts";

export const inventoryProductionMaterials = pgTable(
  "inventory_production_materials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildId: uuid("build_id")
      .notNull()
      .references(() => inventoryProductionBuilds.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    requiredReleaseId: uuid("required_release_id"),
    perUnit: integer("per_unit").notNull(),
    stockUnit: text("stock_unit").$type<CatalogUnit>().notNull(),
    consumable: boolean("consumable").notNull(),
  },
  (table) => [
    unique("inventory_production_material_item_key").on(table.id, table.itemId),
    unique("inventory_production_material_requirement_key")
      .on(table.buildId, table.itemId, table.requiredReleaseId, table.consumable)
      .nullsNotDistinct(),
    foreignKey({
      name: "inventory_production_material_release_fk",
      columns: [table.requiredReleaseId, table.itemId],
      foreignColumns: [inventoryProductReleases.id, inventoryProductReleases.itemId],
    }),
    check(
      "inventory_production_material_qty_check",
      sql`${table.perUnit} BETWEEN 1 AND 1000000000`,
    ),
    check(
      "inventory_production_material_consume_check",
      sql`NOT ${table.consumable} OR ${table.requiredReleaseId} IS NULL`,
    ),
  ],
);

export const inventoryProductionAllocations = pgTable(
  "inventory_production_allocations",
  {
    materialId: uuid("material_id").notNull(),
    positionId: uuid("position_id").notNull(),
    itemId: uuid("item_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_production_allocation_pkey",
      columns: [table.materialId, table.positionId],
    }),
    index("inventory_production_allocation_position_idx").on(table.positionId),
    foreignKey({
      name: "inventory_production_allocation_material_fk",
      columns: [table.materialId, table.itemId],
      foreignColumns: [inventoryProductionMaterials.id, inventoryProductionMaterials.itemId],
    }),
    foreignKey({
      name: "inventory_production_allocation_position_fk",
      columns: [table.positionId, table.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    check(
      "inventory_production_allocation_qty_check",
      sql`${table.quantity} BETWEEN 1 AND 1000000000`,
    ),
  ],
);

export const inventoryProductionInputs = pgTable(
  "inventory_production_inputs",
  {
    outputId: uuid("output_id")
      .notNull()
      .references(() => inventoryProductionOutputs.id),
    materialId: uuid("material_id").notNull(),
    positionId: uuid("position_id").notNull(),
    itemId: uuid("item_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => inventoryStockEvents.id),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_production_input_pkey",
      columns: [table.outputId, table.materialId, table.positionId],
    }),
    unique("inventory_production_input_event_key").on(table.eventId),
    foreignKey({
      name: "inventory_production_input_material_fk",
      columns: [table.materialId, table.itemId],
      foreignColumns: [inventoryProductionMaterials.id, inventoryProductionMaterials.itemId],
    }),
    foreignKey({
      name: "inventory_production_input_position_fk",
      columns: [table.positionId, table.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    check("inventory_production_input_qty_check", sql`${table.quantity} BETWEEN 1 AND 1000000000`),
  ],
);

export const inventoryProductionTasks = pgTable(
  "inventory_production_tasks",
  {
    buildId: uuid("build_id").notNull(),
    projectId: uuid("project_id").notNull(),
    itemId: uuid("item_id").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_production_task_pkey",
      columns: [table.buildId, table.position],
    }),
    unique("inventory_production_task_item_key").on(table.projectId, table.itemId),
    foreignKey({
      name: "inventory_production_task_build_fk",
      columns: [table.buildId, table.projectId],
      foreignColumns: [inventoryProductionBuilds.id, inventoryProductionBuilds.projectId],
    }),
    foreignKey({
      name: "inventory_production_task_item_fk",
      columns: [table.itemId, table.projectId],
      foreignColumns: [internalProjectItems.id, internalProjectItems.projectId],
    }),
    check("inventory_production_task_position_check", sql`${table.position} BETWEEN 0 AND 9`),
  ],
);

export const inventoryProductionReceipts = pgTable(
  "inventory_production_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    buildId: uuid("build_id")
      .notNull()
      .references(() => inventoryProductionBuilds.id),
    command: text("command").$type<ProductionCommand["type"]>().notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "inventory_production_receipt_pkey",
      columns: [table.actorId, table.requestId],
    }),
    index("inventory_production_receipt_build_time_idx").on(table.buildId, table.createdAt),
    check(
      "inventory_production_receipt_fingerprint_check",
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "inventory_production_receipt_reason_check",
      sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`,
    ),
  ],
);

export type ProductionMaterialRow = typeof inventoryProductionMaterials.$inferSelect;
export type ProductionAllocationRow = typeof inventoryProductionAllocations.$inferSelect;
