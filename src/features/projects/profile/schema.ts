import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { internalProjectItems } from "../schema";

export type ProjectItemEventKind = "created" | "updated";

export const internalProjectItemSubscriptions = pgTable(
  "internal_project_item_subscriptions",
  {
    userId: uuid("user_id").notNull(),
    itemId: uuid("item_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.itemId] }),
    foreignKey({
      name: "internal_project_item_subscriptions_user_fkey",
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "internal_project_item_subscriptions_item_fkey",
      columns: [table.itemId],
      foreignColumns: [internalProjectItems.id],
    }).onDelete("cascade"),
    index("internal_project_item_subscriptions_item_idx").on(table.itemId),
  ],
);

export const internalProjectItemEvents = pgTable(
  "internal_project_item_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    kind: text("kind").$type<ProjectItemEventKind>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "internal_project_item_events_item_fkey",
      columns: [table.itemId],
      foreignColumns: [internalProjectItems.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "internal_project_item_events_actor_fkey",
      columns: [table.actorId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    index("internal_project_item_events_actor_order_idx").on(
      table.actorId,
      table.recordedAt,
      table.id,
    ),
    index("internal_project_item_events_item_idx").on(table.itemId),
    check("internal_project_item_events_kind_check", sql`${table.kind} IN ('created', 'updated')`),
  ],
);
