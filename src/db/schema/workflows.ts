import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { WorkflowDefinition } from "@/features/workflows/schemas";
import { users } from "./identity";

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(1),
    draft: jsonb("draft").$type<WorkflowDefinition>().notNull(),
    publishedNumber: integer("published_number"),
    active: boolean("active").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workflows_owner_idx").on(t.ownerId),
    check("workflows_revision_positive", sql`${t.revision} > 0`),
    check(
      "workflows_active_published",
      sql`NOT ${t.active} OR (${t.publishedNumber} IS NOT NULL AND ${t.archivedAt} IS NULL)`,
    ),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<WorkflowDefinition>().notNull(),
    publishedBy: uuid("published_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("workflow_version_number_unique").on(t.workflowId, t.number),
    check("workflow_version_number_positive", sql`${t.number} > 0`),
  ],
);
