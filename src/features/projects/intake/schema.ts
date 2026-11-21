import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { ProjectPriority } from "../contracts";
import { internalProjectItems } from "../schema";
import type { ProjectIntakeStatus } from "./contracts";

export const internalProjectIntakeRequests = pgTable(
  "internal_project_intake_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => agencyProjects.id, { onDelete: "restrict" }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createIntentId: uuid("create_intent_id").notNull(),
    fromPublication: boolean("from_publication").notNull().default(false),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: text("priority").$type<ProjectPriority>().notNull().default("none"),
    status: text("status").$type<ProjectIntakeStatus>().notNull().default("pending"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    workItemId: uuid("work_item_id"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("internal_project_intake_request_intent_key").on(
      table.projectId,
      table.requesterId,
      table.createIntentId,
    ),
    foreignKey({
      name: "internal_project_intake_request_item_fk",
      columns: [table.workItemId, table.projectId],
      foreignColumns: [internalProjectItems.id, internalProjectItems.projectId],
    }).onDelete("restrict"),
    check(
      "internal_project_intake_request_title_check",
      sql`public.agency_project_title_valid(${table.title})`,
    ),
    check(
      "internal_project_intake_request_description_check",
      sql`char_length(${table.description}) <= 10000`,
    ),
    check(
      "internal_project_intake_request_priority_check",
      sql`${table.priority} IN ('urgent', 'high', 'medium', 'low', 'none')`,
    ),
    check(
      "internal_project_intake_request_status_check",
      sql`${table.status} IN ('pending', 'snoozed', 'accepted', 'declined', 'duplicate')`,
    ),
    check(
      "internal_project_intake_request_revision_check",
      sql`${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "internal_project_intake_request_review_check",
      sql`
    (${table.reviewedBy} IS NULL) = (${table.reviewedAt} IS NULL)
    AND (${table.status} = 'snoozed') = (${table.snoozedUntil} IS NOT NULL)
    AND (${table.status} IN ('accepted', 'duplicate')) = (${table.workItemId} IS NOT NULL)
    AND (${table.status} = 'pending' OR ${table.reviewedBy} IS NOT NULL)
    AND (${table.withdrawnAt} IS NULL OR ${table.status} IN ('pending', 'snoozed'))
  `,
    ),
    index("internal_project_intake_request_queue_idx")
      .on(table.projectId, table.status, table.createdAt.desc(), table.id)
      .where(sql`${table.withdrawnAt} IS NULL`),
    index("internal_project_intake_request_reporter_idx").on(table.requesterId, table.projectId),
  ],
);
