import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import { internalProjectItems, internalProjectStates } from "../schema";

export const internalProjectAutomations = pgTable(
  "internal_project_automations",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => agencyProjects.id, { onDelete: "cascade" }),
    archiveAfterMonths: integer("archive_after_months").notNull().default(0),
    closeAfterMonths: integer("close_after_months").notNull().default(0),
    closeStateId: uuid("close_state_id"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "internal_project_automations_close_state_fkey",
      columns: [t.projectId, t.closeStateId],
      foreignColumns: [internalProjectStates.projectId, internalProjectStates.id],
    }).onDelete("restrict"),
    check(
      "internal_project_automations_months_check",
      sql`${t.archiveAfterMonths} BETWEEN 0 AND 12 AND ${t.closeAfterMonths} BETWEEN 0 AND 12`,
    ),
    check(
      "internal_project_automations_close_state_check",
      sql`(${t.closeAfterMonths} = 0) = (${t.closeStateId} IS NULL)`,
    ),
    check(
      "internal_project_automations_revision_check",
      sql`${t.revision} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
);

export const internalProjectAutomationEvents = pgTable(
  "internal_project_automation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    itemId: uuid("item_id").notNull(),
    kind: text("kind").$type<"closed" | "archived">().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "internal_project_automation_events_item_fkey",
      columns: [t.itemId, t.projectId],
      foreignColumns: [internalProjectItems.id, internalProjectItems.projectId],
    }).onDelete("cascade"),
    index("internal_project_automation_events_project_idx").on(t.projectId, t.recordedAt, t.id),
    check(
      "internal_project_automation_events_kind_check",
      sql`${t.kind} IN ('closed', 'archived')`,
    ),
  ],
);
