import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directoryLocations } from "@/features/locations/schema";
import { internalProjectSettings } from "@/features/projects/schema";
import type { CatalogUnit } from "../catalog/contracts";
import { inventoryProductReleases } from "../releases/schema";
import type { ProductionOutputStatus, ProductionPriority, ProductionStatus } from "./contracts";

export const inventoryProductionBuilds = pgTable(
  "inventory_production_builds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    parentId: uuid("parent_id"),
    siteId: uuid("site_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: integer("quantity").notNull(),
    completed: integer("completed").notNull().default(0),
    scrapped: integer("scrapped").notNull().default(0),
    status: text("status").$type<ProductionStatus>().notNull().default("planned"),
    priority: text("priority").$type<ProductionPriority>().notNull(),
    dueDate: date("due_date", { mode: "string" }),
    version: integer("version").notNull().default(1),
    stockUnit: text("stock_unit").$type<CatalogUnit>().notNull(),
    trackable: boolean("trackable").notNull(),
    projectId: uuid("project_id").references(() => internalProjectSettings.projectId),
    templateRevision: integer("template_revision"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("inventory_production_build_origin_key").on(table.id, table.itemId, table.releaseId),
    unique("inventory_production_build_site_key").on(table.id, table.siteId),
    unique("inventory_production_build_project_key").on(table.id, table.projectId),
    index("inventory_production_build_site_idx").on(table.siteId, table.createdAt.desc()),
    index("inventory_production_build_parent_idx").on(table.parentId),
    foreignKey({
      name: "inventory_production_build_release_fk",
      columns: [table.releaseId, table.itemId],
      foreignColumns: [inventoryProductReleases.id, inventoryProductReleases.itemId],
    }),
    foreignKey({
      name: "inventory_production_build_bin_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    foreignKey({
      name: "inventory_production_build_parent_fk",
      columns: [table.parentId, table.siteId],
      foreignColumns: [table.id, table.siteId],
    }),
    check(
      "inventory_production_build_qty_check",
      sql`${table.quantity} BETWEEN 1 AND 1000000 AND ${table.completed} >= 0 AND ${table.scrapped} >= 0 AND ${table.completed} + ${table.scrapped} <= ${table.quantity}`,
    ),
    check(
      "inventory_production_build_status_check",
      sql`${table.status} IN ('planned','issued','on_hold','closed','cancelled') AND (${table.status} <> 'closed' OR ${table.completed} + ${table.scrapped} = ${table.quantity})`,
    ),
    check(
      "inventory_production_build_priority_check",
      sql`${table.priority} IN ('low','normal','high','urgent')`,
    ),
    check("inventory_production_build_parent_check", sql`${table.parentId} <> ${table.id}`),
    check(
      "inventory_production_build_template_check",
      sql`(${table.projectId} IS NULL) = (${table.templateRevision} IS NULL) AND coalesce(${table.templateRevision}, 1) > 0`,
    ),
    check("inventory_production_build_version_check", sql`${table.version} > 0`),
  ],
);

export const inventoryProductionOutputs = pgTable(
  "inventory_production_outputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buildId: uuid("build_id").notNull(),
    itemId: uuid("item_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").$type<ProductionOutputStatus>().notNull().default("wip"),
    lot: text("lot"),
    serials: jsonb("serials").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    reason: text("reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledBy: uuid("settled_by").references(() => users.id),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (table) => [
    unique("inventory_production_output_item_key").on(table.id, table.itemId),
    index("inventory_production_output_build_idx").on(table.buildId, table.createdAt),
    foreignKey({
      name: "inventory_production_output_build_fk",
      columns: [table.buildId, table.itemId, table.releaseId],
      foreignColumns: [
        inventoryProductionBuilds.id,
        inventoryProductionBuilds.itemId,
        inventoryProductionBuilds.releaseId,
      ],
    }),
    check("inventory_production_output_qty_check", sql`${table.quantity} BETWEEN 1 AND 1000000`),
    check(
      "inventory_production_output_state_check",
      sql`${table.status} IN ('wip','completed','scrapped','cancelled','reversed') AND
      ((${table.status} = 'wip') = (${table.settledAt} IS NULL)) AND
      ((${table.settledAt} IS NULL) = (${table.settledBy} IS NULL)) AND
      ((${table.status} = 'reversed') = (${table.reversedAt} IS NOT NULL)) AND
      ((${table.reversedAt} IS NULL) = (${table.reversedBy} IS NULL))`,
    ),
    check(
      "inventory_production_output_detail_check",
      sql`CASE WHEN jsonb_typeof(${table.serials}) = 'array' THEN jsonb_array_length(${table.serials}) <= 500 ELSE false END
      AND (${table.status} <> 'completed' OR ${table.lot} IS NOT NULL)`,
    ),
  ],
);

export type ProductionBuildRow = typeof inventoryProductionBuilds.$inferSelect;
export type ProductionOutputRow = typeof inventoryProductionOutputs.$inferSelect;
