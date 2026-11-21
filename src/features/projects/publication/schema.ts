import { sql } from "drizzle-orm";
import { bigint, boolean, check, pgTable, unique, uuid } from "drizzle-orm/pg-core";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";

export const internalProjectPublications = pgTable(
  "internal_project_publications",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => agencyProjects.id, { onDelete: "restrict" }),
    anchor: uuid("anchor"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    listEnabled: boolean("list_enabled").notNull().default(true),
    boardEnabled: boolean("board_enabled").notNull().default(true),
    showWorkItems: boolean("show_work_items").notNull().default(false),
    showBranding: boolean("show_branding").notNull().default(false),
    allowIntake: boolean("allow_intake").notNull().default(false),
  },
  (table) => [
    unique("internal_project_publications_anchor_key").on(table.anchor),
    check(
      "internal_project_publications_revision_check",
      sql`${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "internal_project_publications_layout_check",
      sql`${table.anchor} IS NULL OR ${table.listEnabled} OR ${table.boardEnabled}`,
    ),
  ],
);
