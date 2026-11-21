import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { ProjectCover, ProjectLogo } from "./brand/contracts";
import type { ProjectPriority, ProjectStateCategory, ProjectStatus, ProjectVisibility } from "./contracts";

export const internalProjectIdentifierSequence = pgSequence("internal_project_identifier_seq", {
  maxValue: 999_999_999,
});

export const internalProjectSettings = pgTable(
  "internal_project_settings",
  {
    projectId: uuid("project_id").primaryKey(),
    identifier: text("identifier").notNull(),
    description: text("description").notNull().default(""),
    timeZone: text("time_zone").notNull().default("UTC"),
    logo: jsonb("logo").$type<ProjectLogo>(),
    cover: jsonb("cover").$type<ProjectCover>(),
    creationTitle: text("creation_title"),
    leadUserId: uuid("lead_user_id"),
    intakeEnabled: boolean("intake_enabled").notNull().default(false),
    visibility: text("visibility").$type<ProjectVisibility>().notNull().default("private"),
    guestViewAllFeatures: boolean("guest_view_all_features").notNull().default(false),
    defaultAssigneeId: uuid("default_assignee_id"),
    lastItemSequence: bigint("last_item_sequence", { mode: "number" }).notNull().default(0),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    foreignKey({
      name: "internal_project_settings_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "internal_project_settings_lead_fkey",
      columns: [table.leadUserId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    foreignKey({
      name: "internal_project_settings_default_assignee_fkey",
      columns: [table.defaultAssigneeId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    unique("internal_project_settings_identifier_key").on(table.identifier),
    check("internal_project_settings_visibility_check", sql`${table.visibility} IN ('private', 'workspace')`),
    check(
      "internal_project_settings_identifier_check",
      sql`${table.identifier} ~ '^[A-Z0-9]{1,10}$'`,
    ),
    check(
      "internal_project_settings_sequence_check",
      sql`${table.lastItemSequence} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "internal_project_settings_description_check",
      sql`char_length(${table.description}) <= 10000`,
    ),
    check(
      "internal_project_settings_time_zone_check",
      sql`${table.timeZone} ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,99}$'`,
    ),
    check(
      "internal_project_settings_creation_title_check",
      sql`${table.creationTitle} IS NULL OR public.agency_project_title_valid(${table.creationTitle})`,
    ),
    check(
      "internal_project_settings_revision_check",
      sql`${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
);

export const internalProjectStates = pgTable(
  "internal_project_states",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    category: text("category").$type<ProjectStateCategory>().notNull(),
    position: integer("position").notNull(),
    color: text("color").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (table) => [
    primaryKey({ name: "internal_project_states_pkey", columns: [table.projectId, table.id] }),
    foreignKey({
      name: "internal_project_states_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    check(
      "internal_project_states_name_check",
      sql`char_length(btrim(${table.name})) BETWEEN 1 AND 80`,
    ),
    check(
      "internal_project_states_category_check",
      sql`${table.category} IN ('backlog', 'unstarted', 'started', 'completed', 'cancelled')`,
    ),
    check("internal_project_states_position_check", sql`${table.position} BETWEEN 0 AND 49`),
    check("internal_project_states_color_check", sql`${table.color} ~ '^#[a-f0-9]{6}$'`),
  ],
);

export const internalProjectItems = pgTable(
  "internal_project_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<ProjectStatus>().notNull().default("todo"),
    stateId: uuid("state_id"),
    sequenceNumber: bigint("sequence_number", { mode: "number" }),
    assigneeId: uuid("assignee_id"),
    priority: text("priority").$type<ProjectPriority>().notNull().default("none"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    description: text("description").notNull().default(""),
    createdBy: uuid("created_by"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "internal_project_items_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "internal_project_items_project_state_fkey",
      columns: [table.projectId, table.stateId],
      foreignColumns: [internalProjectStates.projectId, internalProjectStates.id],
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
    check("internal_project_items_state_required_check", sql`${table.stateId} IS NOT NULL`),
    check(
      "internal_project_items_sequence_check",
      sql`${table.sequenceNumber} IS NOT NULL AND ${table.sequenceNumber} BETWEEN 1 AND 9007199254740991`,
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
    index("internal_project_items_active_age_idx")
      .on(table.projectId, table.updatedAt, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    index("internal_project_items_created_by_idx").on(table.createdBy),
    index("internal_project_items_state_idx").on(table.projectId, table.stateId),
    unique("internal_project_items_id_project_key").on(table.id, table.projectId),
    unique("internal_project_items_project_sequence_key").on(table.projectId, table.sequenceNumber),
  ],
);
