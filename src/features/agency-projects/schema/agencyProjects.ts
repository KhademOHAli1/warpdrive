import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "@/db/schema/deals";
import { users } from "@/db/schema/identity";
import { organizations } from "@/db/schema/organizations";
import { persons } from "@/db/schema/persons";
import type { ProjectState } from "../projectLifecycle";

type UnarchivedProjectState = Exclude<ProjectState, "archived">;

// The canonical migration also retains the manual title function and audit triggers,
// which Drizzle table metadata cannot model.
export const agencyProjects = pgTable(
  "agency_projects",
  {
    id: uuid("id").notNull().defaultRandom(),
    title: text("title").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    dealId: uuid("deal_id"),
    personId: uuid("person_id"),
    orgId: uuid("org_id"),
    state: text("state").$type<ProjectState>().notNull().default("planned"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    archivedFrom: text("archived_from").$type<UnarchivedProjectState>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "agency_projects_pkey", columns: [table.id] }),
    foreignKey({
      name: "agency_projects_owner_user_id_fkey",
      columns: [table.ownerUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "agency_projects_deal_id_fkey",
      columns: [table.dealId],
      foreignColumns: [deals.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "agency_projects_person_id_fkey",
      columns: [table.personId],
      foreignColumns: [persons.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "agency_projects_org_id_fkey",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    check("agency_projects_title_check", sql`public.agency_project_title_valid(${table.title})`),
    check("agency_projects_revision_check", sql`${table.revision} BETWEEN 0 AND 9007199254740991`),
    check(
      "agency_projects_state_check",
      sql`${table.state} IN ('planned', 'active', 'on-hold', 'completed', 'canceled', 'archived')`,
    ),
    check(
      "agency_projects_archive_check",
      sql`
      (${table.state} = 'archived' AND ${table.archivedFrom} IS NOT NULL
        AND ${table.archivedFrom} IN ('planned', 'active', 'on-hold', 'completed', 'canceled'))
      OR (${table.state} <> 'archived' AND ${table.archivedFrom} IS NULL)
    `,
    ),
    check(
      "agency_projects_anchor_check",
      sql`${table.dealId} IS NOT NULL OR ${table.personId} IS NOT NULL OR ${table.orgId} IS NOT NULL`,
    ),
  ],
);

export const agencyProjectMembers = pgTable(
  "agency_project_members",
  {
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id").notNull(),
    projectEdit: boolean("project_edit").notNull().default(false),
    assignmentCoordinate: boolean("assignment_coordinate").notNull().default(false),
  },
  (table) => [
    primaryKey({ name: "agency_project_members_pkey", columns: [table.projectId, table.userId] }),
    foreignKey({
      name: "agency_project_members_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "agency_project_members_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
  ],
);

export type AgencyProject = typeof agencyProjects.$inferSelect;
export type NewAgencyProject = typeof agencyProjects.$inferInsert;
export type AgencyProjectMember = typeof agencyProjectMembers.$inferSelect;
export type NewAgencyProjectMember = typeof agencyProjectMembers.$inferInsert;
