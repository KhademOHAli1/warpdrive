import { sql } from "drizzle-orm";
import {
  boolean,
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
import { users } from "@/db/schema/identity";
import { inventoryItems } from "../schema";
import type { CatalogCategory, CatalogProfile } from "./contracts";

export const inventoryPartFamilies = pgTable(
  "inventory_part_families",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull(),
  },
  (table) => [
    unique("inventory_part_families_code_key").on(table.code),
    check("inventory_part_families_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'`),
  ],
);

export const inventoryPartCategories = pgTable(
  "inventory_part_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    defaultUnit: text("default_unit").$type<CatalogCategory["defaultUnit"]>(),
    parameters: jsonb("parameters").$type<CatalogCategory["parameters"]>().notNull(),
  },
  (table) => [
    unique("inventory_part_categories_code_key").on(table.code),
    foreignKey({
      name: "inventory_part_category_parent_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    }),
    index("inventory_part_categories_parent_idx").on(table.parentId),
    check(
      "inventory_part_categories_code_check",
      sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'`,
    ),
    check(
      "inventory_part_categories_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 120`,
    ),
    check("inventory_part_categories_no_self_parent", sql`${table.parentId} <> ${table.id}`),
  ],
);

export const inventoryPartStates = pgTable(
  "inventory_part_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull(),
    locked: boolean("locked").notNull(),
  },
  (table) => [
    unique("inventory_part_states_code_key").on(table.code),
    check("inventory_part_states_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'`),
    check("inventory_part_states_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 120`),
  ],
);

export const inventoryPartProfiles = pgTable(
  "inventory_part_profiles",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => inventoryPartFamilies.id),
    revisionKey: text("revision_key").notNull(),
    version: integer("version").notNull().default(0),
    categoryId: uuid("category_id").references(() => inventoryPartCategories.id),
    stateId: uuid("state_id").references(() => inventoryPartStates.id),
    templateItemId: uuid("template_item_id").references(() => inventoryItems.id),
    supersedesItemId: uuid("supersedes_item_id").references(() => inventoryItems.id),
    relatedItemIds: jsonb("related_item_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    description: text("description").notNull().default(""),
    notes: text("notes").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    unit: text("unit").$type<CatalogProfile["unit"]>().notNull().default("each"),
    stockMode: text("stock_mode").$type<CatalogProfile["stockMode"]>().notNull().default("stocked"),
    visibility: text("visibility").$type<CatalogProfile["visibility"]>().notNull().default("staff"),
    isTemplate: boolean("is_template").notNull().default(false),
    flags: jsonb("flags").$type<CatalogProfile["flags"]>().notNull(),
    values: jsonb("parameter_values")
      .$type<CatalogProfile["values"]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (table) => [
    unique("inventory_part_family_revision_key").on(table.familyId, table.revisionKey),
    index("inventory_part_profiles_category_idx").on(table.categoryId),
    index("inventory_part_profiles_state_idx").on(table.stateId),
    index("inventory_part_profiles_template_idx").on(table.templateItemId),
    index("inventory_part_profiles_supersedes_idx").on(table.supersedesItemId),
    check("inventory_part_profiles_version_check", sql`${table.version} >= 0`),
    check(
      "inventory_part_profiles_template_self_check",
      sql`${table.templateItemId} <> ${table.itemId}`,
    ),
    check(
      "inventory_part_profiles_supersedes_self_check",
      sql`${table.supersedesItemId} <> ${table.itemId}`,
    ),
    check(
      "inventory_part_profiles_stock_mode_check",
      sql`${table.stockMode} IN ('stocked', 'virtual', 'consumable')`,
    ),
    check(
      "inventory_part_profiles_visibility_check",
      sql`${table.visibility} IN ('staff', 'admin')`,
    ),
  ],
);

export const inventoryCatalogReceipts = pgTable(
  "inventory_catalog_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    focusId: uuid("focus_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "inventory_catalog_receipts_pkey",
      columns: [table.actorId, table.requestId],
    }),
    check(
      "inventory_catalog_receipts_fingerprint_check",
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
