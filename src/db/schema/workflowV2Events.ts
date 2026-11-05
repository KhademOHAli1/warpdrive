import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { BlockOutput } from "@/features/blocks/contracts";
export const workflowV2RecordEvents = pgTable(
  "workflow_v2_record_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entity: text("entity").notNull(),
    recordId: uuid("record_id").notNull(),
    eventName: text("event_name").notNull(),
    before: jsonb("before").$type<BlockOutput>(),
    after: jsonb("after").$type<BlockOutput>(),
    changedFields: jsonb("changed_fields").$type<string[]>().notNull(),
    originRunId: uuid("origin_run_id"),
    status: text("status")
      .$type<"pending" | "claimed" | "delivered" | "failed">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    errorId: text("error_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    index("workflow_v2_record_event_pending_idx").on(t.status, t.createdAt),
    check(
      "workflow_v2_record_event_status",
      sql`${t.status} IN ('pending','claimed','delivered','failed')`,
    ),
    check(
      "workflow_v2_record_event_entity",
      sql`${t.entity} IN ('deal','lead','person','organization','activity')`,
    ),
  ],
);
