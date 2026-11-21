import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { ProjectStatus } from "./contracts";

export const internalProjectItems = pgTable(
  "internal_project_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<ProjectStatus>().notNull().default("todo"),
    assigneeId: uuid("assignee_id"),
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
    check(
      "internal_project_items_title_check",
      sql`public.agency_project_title_valid(${table.title})`,
    ),
    check(
      "internal_project_items_status_check",
      sql`${table.status} IN ('todo', 'in-progress', 'done')`,
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
  ],
);
