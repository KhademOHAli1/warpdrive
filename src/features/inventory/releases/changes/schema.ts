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
import { directorySites } from "@/features/locations/schema";
import { inventoryProductionOutputs } from "../../production/buildSchema";
import { inventoryItems } from "../../schema";
import { inventoryStockEvents, inventoryStockPositions } from "../../warehouse/schema";
import { inventoryProductReleases } from "../schema";
import type { ChangeReview, EngineeringChange, EngineeringChangeEvent } from "./contracts";

export const inventoryEngineeringChanges = pgTable(
  "inventory_engineering_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    baseReleaseId: uuid("base_release_id").notNull(),
    candidateReleaseId: uuid("candidate_release_id").notNull(),
    status: text("status").$type<EngineeringChange["status"]>().notNull().default("review"),
    version: integer("version").notNull().default(1),
    reason: text("reason").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    review: jsonb("review").$type<ChangeReview>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [
    unique("inventory_eng_changes_item_key").on(t.id, t.itemId),
    unique("inventory_eng_changes_base_key").on(t.id, t.itemId, t.baseReleaseId),
    foreignKey({
      name: "inventory_eng_changes_base_fk",
      columns: [t.baseReleaseId, t.itemId],
      foreignColumns: [inventoryProductReleases.id, inventoryProductReleases.itemId],
    }),
    foreignKey({
      name: "inventory_eng_changes_candidate_fk",
      columns: [t.candidateReleaseId, t.itemId],
      foreignColumns: [inventoryProductReleases.id, inventoryProductReleases.itemId],
    }),
    uniqueIndex("inventory_eng_changes_active_item_key")
      .on(t.itemId)
      .where(sql`${t.status} IN ('review','returned')`),
    uniqueIndex("inventory_eng_changes_candidate_key")
      .on(t.candidateReleaseId)
      .where(sql`${t.status} <> 'withdrawn'`),
    index("inventory_eng_changes_effectivity_idx")
      .on(t.itemId, t.effectiveAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'approved'`),
    index("inventory_eng_changes_baseline_idx")
      .on(t.itemId, t.createdAt, t.id)
      .where(sql`${t.status} <> 'withdrawn'`),
    index("inventory_eng_changes_recent_idx").on(t.itemId, t.updatedAt.desc(), t.id.desc()),
    check(
      "inventory_eng_changes_distinct_release_check",
      sql`${t.baseReleaseId} <> ${t.candidateReleaseId}`,
    ),
    check(
      "inventory_eng_changes_snapshot_check",
      sql`
      ${t.fingerprint} ~ '^[0-9a-f]{64}$' AND coalesce(${t.review}->>'fingerprint' = ${t.fingerprint}, false)
      AND coalesce(${t.review}->'base'->>'id' = ${t.baseReleaseId}::text, false)
      AND coalesce(${t.review}->'candidate'->>'id' = ${t.candidateReleaseId}::text, false)
      AND coalesce(${t.review}->'ready' = 'true'::jsonb, false)
      AND length(btrim(${t.reason})) BETWEEN 1 AND 300
      AND ${t.version} > 0 AND ${t.updatedAt} >= ${t.createdAt}`,
    ),
    check(
      "inventory_eng_changes_status_check",
      sql`
      ${t.status} IN ('review','returned','approved','withdrawn')
      AND (${t.approvedBy} IS NOT NULL) = (${t.status} = 'approved')
      AND (${t.approvedAt} IS NOT NULL) = (${t.status} = 'approved')
      AND (${t.approvedAt} IS NULL OR ${t.approvedAt} < ${t.effectiveAt})`,
    ),
  ],
);

export const inventoryEngineeringEvents = pgTable(
  "inventory_engineering_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    changeId: uuid("change_id")
      .notNull()
      .references(() => inventoryEngineeringChanges.id),
    version: integer("version").notNull(),
    type: text("type").$type<EngineeringChangeEvent["type"]>().notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    review: jsonb("review").$type<ChangeReview>(),
  },
  (t) => [
    unique("inventory_eng_events_change_version_key").on(t.changeId, t.version),
    check(
      "inventory_eng_events_shape_check",
      sql`
      ${t.version} > 0 AND ${t.type} IN ('submitted','returned','approved','withdrawn')
      AND length(btrim(${t.actorName})) BETWEEN 1 AND 180
      AND (${t.note} IS NULL OR length(btrim(${t.note})) BETWEEN 1 AND 300)
      AND (${t.type} <> 'returned' OR ${t.note} IS NOT NULL)
      AND (${t.type} <> 'submitted' OR ${t.review} IS NOT NULL)`,
    ),
  ],
);

export const inventoryEngineeringRequests = pgTable(
  "inventory_engineering_requests",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    itemId: uuid("item_id").notNull(),
    changeId: uuid("change_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "inventory_eng_requests_pkey", columns: [t.actorId, t.requestId] }),
    foreignKey({
      name: "inventory_eng_requests_change_fk",
      columns: [t.changeId, t.itemId],
      foreignColumns: [inventoryEngineeringChanges.id, inventoryEngineeringChanges.itemId],
    }),
    index("inventory_eng_requests_change_idx").on(t.changeId),
    check("inventory_eng_requests_fingerprint_check", sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const inventoryEngineeringHolds = pgTable(
  "inventory_engineering_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    changeId: uuid("change_id").notNull(),
    itemId: uuid("item_id").notNull(),
    baseReleaseId: uuid("base_release_id").notNull(),
    positionId: uuid("position_id").notNull(),
    buildOutputId: uuid("build_output_id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    holdEventId: uuid("hold_event_id")
      .notNull()
      .references(() => inventoryStockEvents.id),
    releaseEventId: uuid("release_event_id").references(() => inventoryStockEvents.id),
  },
  (t) => [
    foreignKey({
      name: "inventory_eng_holds_change_fk",
      columns: [t.changeId, t.itemId, t.baseReleaseId],
      foreignColumns: [
        inventoryEngineeringChanges.id,
        inventoryEngineeringChanges.itemId,
        inventoryEngineeringChanges.baseReleaseId,
      ],
    }),
    foreignKey({
      name: "inventory_eng_holds_position_fk",
      columns: [t.positionId, t.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    foreignKey({
      name: "inventory_eng_holds_output_fk",
      columns: [t.buildOutputId, t.itemId],
      foreignColumns: [inventoryProductionOutputs.id, inventoryProductionOutputs.itemId],
    }),
    uniqueIndex("inventory_eng_holds_active_position_key")
      .on(t.positionId)
      .where(sql`${t.releaseEventId} IS NULL`),
    unique("inventory_eng_holds_hold_event_key").on(t.holdEventId),
    unique("inventory_eng_holds_release_event_key").on(t.releaseEventId),
    index("inventory_eng_holds_change_position_idx").on(t.changeId, t.positionId),
    check(
      "inventory_eng_holds_distinct_events_check",
      sql`${t.holdEventId} <> ${t.releaseEventId}`,
    ),
  ],
);

export type EngineeringChangeRow = typeof inventoryEngineeringChanges.$inferSelect;
