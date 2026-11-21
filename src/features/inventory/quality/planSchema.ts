import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { inventoryItems } from "../schema";
import type { QualityStepDraft } from "./contracts";

export const inventoryQualityPlanVersions = pgTable(
  "inventory_quality_plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    steps: jsonb("steps").$type<QualityStepDraft[]>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_quality_plan_item_version_key").on(t.itemId, t.version),
    unique("inventory_quality_plan_id_item_key").on(t.id, t.itemId),
    unique("inventory_quality_plan_request_key").on(t.createdBy, t.requestId),
    check(
      "inventory_quality_plan_version_check",
      sql`${t.version} > 0 AND length(${t.name}) BETWEEN 1 AND 100 AND
        CASE WHEN jsonb_typeof(${t.steps}) = 'array' THEN jsonb_array_length(${t.steps}) BETWEEN 1 AND 32 ELSE false END`,
    ),
  ],
);

export type QualityPlanRow = typeof inventoryQualityPlanVersions.$inferSelect;
