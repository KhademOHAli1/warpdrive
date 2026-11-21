import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "@/db/schema/organizations";
import { directorySites } from "@/features/locations/schema";
import type { CatalogUnit } from "../catalog/contracts";
import { inventoryItems } from "../schema";

export const inventoryManufacturerParts = pgTable(
  "inventory_manufacturer_parts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    partNumber: text("part_number").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("inventory_manufacturer_parts_scope_id_key").on(table.siteId, table.itemId, table.id),
    uniqueIndex("inventory_manufacturer_parts_number_key").on(
      table.siteId,
      table.itemId,
      table.organizationId,
      sql`lower(${table.partNumber})`,
    ),
    check(
      "inventory_manufacturer_parts_number_check",
      sql`length(${table.partNumber}) BETWEEN 1 AND 120 AND ${table.partNumber} = btrim(${table.partNumber})`,
    ),
    check("inventory_manufacturer_parts_version_check", sql`${table.version} >= 1`),
  ],
);

export const inventorySupplierOffers = pgTable(
  "inventory_supplier_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    supplierOrganizationId: uuid("supplier_organization_id")
      .notNull()
      .references(() => organizations.id),
    manufacturerPartId: uuid("manufacturer_part_id"),
    partNumber: text("part_number").notNull(),
    packQuantity: integer("pack_quantity").notNull(),
    stockUnit: text("stock_unit").$type<CatalogUnit>().notNull(),
    approved: boolean("approved").notNull().default(false),
    available: boolean("available").notNull().default(true),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("inventory_supplier_offers_scope_id_key").on(table.siteId, table.itemId, table.id),
    uniqueIndex("inventory_supplier_offers_number_key").on(
      table.siteId,
      table.itemId,
      table.supplierOrganizationId,
      sql`lower(${table.partNumber})`,
    ),
    foreignKey({
      name: "inventory_supplier_offers_manufacturer_scope_fk",
      columns: [table.siteId, table.itemId, table.manufacturerPartId],
      foreignColumns: [
        inventoryManufacturerParts.siteId,
        inventoryManufacturerParts.itemId,
        inventoryManufacturerParts.id,
      ],
    }),
    index("inventory_supplier_offers_manufacturer_idx").on(table.manufacturerPartId),
    check(
      "inventory_supplier_offers_number_check",
      sql`length(${table.partNumber}) BETWEEN 1 AND 120 AND ${table.partNumber} = btrim(${table.partNumber})`,
    ),
    check(
      "inventory_supplier_offers_pack_check",
      sql`${table.packQuantity} BETWEEN 1 AND 1000000000`,
    ),
    check("inventory_supplier_offers_version_check", sql`${table.version} >= 1`),
  ],
);

export const inventorySupplierPriceTiers = pgTable(
  "inventory_supplier_price_tiers",
  {
    offerId: uuid("offer_id")
      .notNull()
      .references(() => inventorySupplierOffers.id),
    minPacks: integer("min_packs").notNull(),
    currency: text("currency").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    packQuantity: integer("pack_quantity").notNull(),
    stockUnit: text("stock_unit").$type<CatalogUnit>().notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_supplier_price_tiers_pkey",
      columns: [table.offerId, table.currency, table.minPacks],
    }),
    check(
      "inventory_supplier_price_tiers_min_packs_check",
      sql`${table.minPacks} BETWEEN 1 AND 1000000000`,
    ),
    check(
      "inventory_supplier_price_tiers_pack_check",
      sql`${table.packQuantity} BETWEEN 1 AND 1000000000
        AND ${table.minPacks}::bigint * ${table.packQuantity} <= 1000000000`,
    ),
    check("inventory_supplier_price_tiers_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "inventory_supplier_price_tiers_amount_check",
      sql`${table.amount} BETWEEN 0 AND 99999999999999.9999`,
    ),
  ],
);

export const inventoryItemCostOverrides = pgTable(
  "inventory_item_cost_overrides",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    currency: text("currency").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_item_cost_overrides_pkey",
      columns: [table.siteId, table.itemId],
    }),
    check("inventory_item_cost_overrides_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "inventory_item_cost_overrides_amount_check",
      sql`${table.amount} BETWEEN 0 AND 99999999999999.9999`,
    ),
  ],
);
