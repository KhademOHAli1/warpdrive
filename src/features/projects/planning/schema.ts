import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
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
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import { internalProjectItems } from "../schema";
import type {
  PlanningGroupKind,
  PlanningModuleStatus,
  PlanningSavedView,
  PlanningViewFilters,
} from "./contracts";

export const internalProjectPlanningGroups = pgTable(
  "internal_project_planning_groups",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => agencyProjects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PlanningGroupKind>().notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    moduleStatus: text("module_status").$type<PlanningModuleStatus>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    unique("internal_project_planning_group_scope_key").on(t.id, t.kind, t.projectId),
    index("internal_project_planning_groups_project_idx").on(t.projectId, t.kind),
    check(
      "internal_project_planning_groups_kind_check",
      sql`
    (${t.kind} = 'cycles' AND ${t.moduleStatus} IS NULL AND (${t.startDate} IS NULL) = (${t.endDate} IS NULL))
    OR (${t.kind} = 'modules' AND ${t.moduleStatus} IS NOT NULL AND ${t.moduleStatus} IN ('backlog','planned','in-progress','paused','completed','cancelled'))
  `,
    ),
    check(
      "internal_project_planning_groups_title_check",
      sql`public.agency_project_title_valid(${t.title})`,
    ),
    check(
      "internal_project_planning_groups_details_check",
      sql`char_length(${t.description}) <= 4000 AND ${t.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "internal_project_planning_groups_dates_check",
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`,
    ),
  ],
);

export const internalProjectPlanningAssignments = pgTable(
  "internal_project_planning_assignments",
  {
    groupId: uuid("group_id").notNull(),
    itemId: uuid("item_id").notNull(),
    projectId: uuid("project_id").notNull(),
    kind: text("kind").$type<PlanningGroupKind>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.itemId] }),
    foreignKey({
      name: "internal_project_planning_assignments_group_fkey",
      columns: [t.groupId, t.kind, t.projectId],
      foreignColumns: [
        internalProjectPlanningGroups.id,
        internalProjectPlanningGroups.kind,
        internalProjectPlanningGroups.projectId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "internal_project_planning_assignments_item_fkey",
      columns: [t.itemId, t.projectId],
      foreignColumns: [internalProjectItems.id, internalProjectItems.projectId],
    }).onDelete("cascade"),
    index("internal_project_planning_assignments_item_idx").on(t.itemId),
    uniqueIndex("internal_project_planning_one_cycle_per_item")
      .on(t.itemId)
      .where(sql`${t.kind} = 'cycles'`),
  ],
);

export const internalProjectSavedViews = pgTable(
  "internal_project_saved_views",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => agencyProjects.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    layout: text("layout").$type<PlanningSavedView["layout"]>().notNull(),
    visibility: text("visibility").$type<PlanningSavedView["visibility"]>().notNull(),
    filters: jsonb("filters").$type<PlanningViewFilters>().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    index("internal_project_saved_views_project_idx").on(t.projectId),
    index("internal_project_saved_views_owner_idx").on(t.ownerId),
    check(
      "internal_project_saved_views_title_check",
      sql`public.agency_project_title_valid(${t.title})`,
    ),
    check(
      "internal_project_saved_views_details_check",
      sql`char_length(${t.description}) <= 4000 AND ${t.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "internal_project_saved_views_layout_check",
      sql`${t.layout} IN ('list','board','calendar','gantt_chart','spreadsheet') AND ${t.visibility} IN ('project','private') AND jsonb_typeof(${t.filters}) = 'object'`,
    ),
  ],
);
