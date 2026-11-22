import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { assetKits } from "@/features/assets/kits/schema";
import { assetRecords } from "@/features/assets/schema";
import { inventoryProductReleases } from "@/features/inventory/releases/schema";
import { inventoryItems } from "@/features/inventory/schema";
import { inventorySupplierOffers } from "@/features/inventory/sourcing/schema";
import { inventoryStockPositions } from "@/features/inventory/warehouse/schema";
import { directoryLocations } from "@/features/locations/schema";
import type { LabelCommand, LabelRecord, LabelTargetKind } from "./contracts";
import type { LabelFormat } from "./formats";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const physicalLabels = pgTable(
  "physical_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetKind: text("target_kind").$type<LabelTargetKind>().notNull(),
    targetId: uuid("target_id").notNull(),
    assetId: uuid("asset_id").references(() => assetRecords.id),
    kitId: uuid("kit_id").references(() => assetKits.id),
    positionId: uuid("position_id").references(() => inventoryStockPositions.id),
    locationId: uuid("location_id").references(() => directoryLocations.id),
    itemId: uuid("item_id").references(() => inventoryItems.id),
    releaseId: uuid("release_id").references(() => inventoryProductReleases.id),
    supplierOfferId: uuid("supplier_offer_id").references(() => inventorySupplierOffers.id),
    source: text("source").$type<LabelRecord["source"]>().notNull(),
    format: text("format").$type<LabelFormat>().notNull(),
    value: text("value").notNull(),
    key: text("key").notNull(),
    createdAt: instant("created_at").notNull().default(sql`clock_timestamp()`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    retiredAt: instant("retired_at"),
    retiredBy: uuid("retired_by").references(() => users.id, { onDelete: "set null" }),
  },
  (row) => [
    uniqueIndex("physical_labels_key_uidx").on(sql`${row.key} COLLATE "C"`),
    uniqueIndex("physical_labels_active_internal_uidx")
      .on(row.targetKind, row.targetId)
      .where(sql`${row.source} = 'internal' AND ${row.retiredAt} IS NULL`),
    index("physical_labels_subject_idx").on(row.targetKind, row.targetId, row.createdAt),
    check(
      "physical_labels_target_check",
      sql`num_nonnulls(
            ${row.assetId}, ${row.kitId}, ${row.positionId}, ${row.locationId},
            ${row.itemId}, ${row.releaseId}, ${row.supplierOfferId}
          ) = 1 AND ${row.targetId} IS NOT DISTINCT FROM CASE ${row.targetKind}
            WHEN 'asset' THEN ${row.assetId}
            WHEN 'kit' THEN ${row.kitId}
            WHEN 'stock_position' THEN ${row.positionId}
            WHEN 'location' THEN ${row.locationId}
            WHEN 'part' THEN ${row.itemId}
            WHEN 'release' THEN ${row.releaseId}
            WHEN 'supplier_offer' THEN ${row.supplierOfferId}
          END`,
    ),
    check(
      "physical_labels_value_check",
      sql`${row.format} IN ('qr', 'code128', 'code39', 'ean13', 'datamatrix', 'gs1_128', 'gs1_datamatrix')
          AND octet_length(${row.value}) BETWEEN 1 AND 2048
          AND ${row.key} COLLATE "C" =
            (CASE WHEN ${row.format} IN ('gs1_128', 'gs1_datamatrix') THEN 'gs1:' ELSE 'text:' END)
            || ${row.value}`,
    ),
    check(
      "physical_labels_source_check",
      sql`CASE ${row.source}
            WHEN 'internal' THEN
              ${row.format} = 'qr' AND ${row.value} COLLATE "C" ~ '^wd-label:v1:[A-Za-z0-9_-]{22}$'
            WHEN 'external' THEN left(${row.value}, 12) COLLATE "C" <> 'wd-label:v1:'
            ELSE false
          END`,
    ),
    check(
      "physical_labels_retirement_check",
      sql`CASE WHEN ${row.retiredAt} IS NULL THEN ${row.retiredBy} IS NULL
          ELSE ${row.retiredAt} >= ${row.createdAt} END`,
    ),
  ],
);

export const physicalLabelReceipts = pgTable(
  "physical_label_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    commandType: text("command_type").$type<LabelCommand["type"]>().notNull(),
    labelId: uuid("label_id")
      .notNull()
      .references(() => physicalLabels.id),
    createdAt: instant("created_at").notNull().default(sql`clock_timestamp()`),
  },
  (row) => [
    unique("physical_label_receipts_actor_request_key").on(row.actorId, row.requestId),
    index("physical_label_receipts_label_idx").on(row.labelId),
    check(
      "physical_label_receipts_fingerprint_check",
      sql`${row.fingerprint} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "physical_label_receipts_command_check",
      sql`${row.commandType} IN ('issue', 'registerExternal', 'retire')`,
    ),
  ],
);

export type PhysicalLabelRow = typeof physicalLabels.$inferSelect;
export type PhysicalLabelInsert = typeof physicalLabels.$inferInsert;
