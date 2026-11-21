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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import type { CatalogUnit } from "../catalog/contracts";
import type { InventoryBomLine, InventoryTemplate } from "../contracts";
import { inventoryQualityPlanVersions } from "../quality/planSchema";
import { inventoryItems, inventoryOrders } from "../schema";
import { type ReleaseArtifactKind, releaseFixtureMaxFileBytes } from "./contracts";

export type InventoryReleaseRole = "editor" | "approver";
export type ReleaseBomEntry = {
  sku: string;
  quantity: number;
  details?: {
    enteredQuantity: string;
    unit: CatalogUnit | null;
    childRelease: string | null;
    alternateSkus: string[];
    optional: boolean;
    consumable: boolean;
    inherited: boolean;
    pieces: number | null;
  };
};

type ApprovedBomPart = InventoryBomLine & { sku: string; name: string };

export type ApprovedBomLine = ApprovedBomPart & {
  spec?: {
    enteredQuantity: string;
    enteredUnit: CatalogUnit;
    stockUnit: CatalogUnit;
    childReleaseId: string | null;
    alternatives: (ApprovedBomPart & { stockUnit: CatalogUnit })[];
    optional: boolean;
    consumable: boolean;
    inherited: boolean;
    pieces: number | null;
  };
};

export const inventoryProductReleases = pgTable(
  "inventory_product_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    revision: text("revision").notNull(),
    status: text("status").$type<"draft" | "released">().notNull().default("draft"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    qualityPlanVersionId: uuid("quality_plan_version_id"),
    bom: jsonb("bom").$type<ApprovedBomLine[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [
    unique("inventory_product_releases_item_revision_key").on(table.itemId, table.revision),
    unique("inventory_product_releases_id_item_key").on(table.id, table.itemId),
    foreignKey({
      name: "inventory_product_releases_quality_plan_fk",
      columns: [table.qualityPlanVersionId, table.itemId],
      foreignColumns: [inventoryQualityPlanVersions.id, inventoryQualityPlanVersions.itemId],
    }),
    index("inventory_product_releases_active_idx")
      .on(table.itemId, table.approvedAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'released'`),
    check(
      "inventory_product_releases_revision_check",
      sql`${table.revision} ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'`,
    ),
    check(
      "inventory_product_releases_status_check",
      sql`CASE ${table.status}
        WHEN 'draft' THEN ${table.approvedBy} IS NULL AND ${table.approvedAt} IS NULL AND ${table.bom} = '[]'::jsonb
        WHEN 'released' THEN ${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND
          CASE WHEN jsonb_typeof(${table.bom}) = 'array' THEN jsonb_array_length(${table.bom}) BETWEEN 1 AND 30 ELSE false END
        ELSE false
      END`,
    ),
  ],
);

export const inventoryReleaseGrants = pgTable(
  "inventory_release_grants",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").$type<InventoryReleaseRole>().notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_release_grants_pkey",
      columns: [table.itemId, table.userId],
    }),
    index("inventory_release_grants_user_idx").on(table.userId),
    check("inventory_release_grants_role_check", sql`${table.role} IN ('editor', 'approver')`),
  ],
);

export const inventoryReleaseArtifacts = pgTable(
  "inventory_release_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    releaseId: uuid("release_id").notNull(),
    kind: text("kind").$type<ReleaseArtifactKind>().notNull(),
    name: text("name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type").notNull(),
    objectKey: text("object_key").notNull(),
    etag: text("etag"),
    sha256: text("sha256"),
    bomEntries: jsonb("bom_entries").$type<ReleaseBomEntry[]>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    state: text("state").$type<"pending" | "ready">().notNull().default("pending"),
  },
  (table) => [
    foreignKey({
      name: "inventory_release_artifacts_release_fk",
      columns: [table.releaseId],
      foreignColumns: [inventoryProductReleases.id],
    }),
    unique("inventory_release_artifacts_object_key_key").on(table.objectKey),
    uniqueIndex("inventory_release_artifacts_ready_bom_key")
      .on(table.releaseId)
      .where(sql`${table.state} = 'ready' AND ${table.kind} = 'manufacturingBom'`),
    index("inventory_release_artifacts_release_idx").on(table.releaseId),
    check(
      "inventory_release_artifacts_kind_check",
      sql`${table.kind} IN ('pcbFabrication', 'manufacturingBom', 'placement', 'enclosure', 'firmware', 'labelArtwork', 'testInstructions')`,
    ),
    check(
      "inventory_release_artifacts_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 180`,
    ),
    check(
      "inventory_release_artifacts_size_check",
      sql`${table.sizeBytes} BETWEEN 1 AND ${sql.raw(String(releaseFixtureMaxFileBytes))}`,
    ),
    check(
      "inventory_release_artifacts_state_check",
      sql`CASE ${table.state}
        WHEN 'pending' THEN ${table.etag} IS NULL AND ${table.sha256} IS NULL AND ${table.bomEntries} IS NULL
        WHEN 'ready' THEN ${table.etag} IS NOT NULL AND length(${table.etag}) > 0 AND
          ${table.sha256} IS NOT NULL AND ${table.sha256} ~ '^[0-9a-f]{64}$' AND
          CASE WHEN ${table.kind} = 'manufacturingBom'
            THEN CASE WHEN jsonb_typeof(${table.bomEntries}) = 'array'
              THEN jsonb_array_length(${table.bomEntries}) BETWEEN 1 AND 30 ELSE false END
            ELSE ${table.bomEntries} IS NULL
          END
        ELSE false
      END`,
    ),
  ],
);

export const inventoryBuildReleases = pgTable(
  "inventory_build_releases",
  {
    orderId: uuid("order_id").primaryKey(),
    itemId: uuid("item_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    templateSteps: jsonb("template_steps").$type<InventoryTemplate["steps"]>().notNull(),
  },
  (table) => [
    foreignKey({
      name: "inventory_build_releases_order_item_fk",
      columns: [table.orderId, table.itemId],
      foreignColumns: [inventoryOrders.id, inventoryOrders.itemId],
    }),
    foreignKey({
      name: "inventory_build_releases_release_item_fk",
      columns: [table.releaseId, table.itemId],
      foreignColumns: [inventoryProductReleases.id, inventoryProductReleases.itemId],
    }),
    index("inventory_build_releases_release_idx").on(table.releaseId),
    check(
      "inventory_build_releases_template_steps_check",
      sql`CASE WHEN jsonb_typeof(${table.templateSteps}) = 'array' THEN jsonb_array_length(${table.templateSteps}) BETWEEN 1 AND 10 ELSE false END`,
    ),
  ],
);
