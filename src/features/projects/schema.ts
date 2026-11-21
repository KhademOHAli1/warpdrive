import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { ProjectPriority, ProjectStatus } from "./contracts";

export const internalProjectItems = pgTable(
  "internal_project_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<ProjectStatus>().notNull().default("todo"),
    assigneeId: uuid("assignee_id"),
    priority: text("priority").$type<ProjectPriority>().notNull().default("none"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    description: text("description").notNull().default(""),
    createdBy: uuid("created_by"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "internal_project_items_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "internal_project_items_assignee_id_fkey",
      columns: [table.assigneeId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "internal_project_items_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    check(
      "internal_project_items_title_check",
      sql`public.agency_project_title_valid(${table.title})`,
    ),
    check(
      "internal_project_items_status_check",
      sql`${table.status} IN ('todo', 'in-progress', 'done')`,
    ),
    check(
      "internal_project_items_priority_check",
      sql`${table.priority} IN ('urgent', 'high', 'medium', 'low', 'none')`,
    ),
    check(
      "internal_project_items_date_order_check",
      sql`${table.startDate} IS NULL OR ${table.dueDate} IS NULL OR ${table.startDate} <= ${table.dueDate}`,
    ),
    check(
      "internal_project_items_description_check",
      sql`char_length(${table.description}) <= 10000`,
    ),
    check(
      "internal_project_items_revision_check",
      sql`${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    index("internal_project_items_project_order_idx").on(
      table.projectId,
      table.createdAt,
      table.id,
    ),
    index("internal_project_items_created_by_idx").on(table.createdBy),
  ],
);
