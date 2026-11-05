import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "@/db/schema/deals";
import { users, visibilityGroups, visibilityLevelEnum } from "@/db/schema/identity";
import { organizations } from "@/db/schema/organizations";
import { persons } from "@/db/schema/persons";
import type {
  InstalledResource,
  WorkFieldDefinition,
  WorkKind,
  WorkPreferences,
} from "./contracts";

export const workspaceWorkProfiles = pgTable(
  "workspace_work_profiles",
  {
    id: boolean("id").primaryKey().default(true),
    revision: integer("revision").notNull().default(0),
    preferences: jsonb("preferences")
      .$type<WorkPreferences>()
      .notNull()
      .default(
        sql`'{"workTypes":[],"primaryWorkType":null,"modules":[],"primaryGoal":"","deliveryModels":[],"customerTypes":[]}'::jsonb`,
      ),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("workspace_work_profiles_singleton", sql`${t.id} = true`),
    check("workspace_work_profiles_revision", sql`${t.revision} >= 0`),
  ],
);
export const workTypes = pgTable(
  "work_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").$type<WorkKind>().notNull(),
    revision: integer("revision").notNull().default(1),
    fields: jsonb("fields").$type<WorkFieldDefinition[]>().notNull().default(sql`'[]'::jsonb`),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "work_types_kind",
      sql`${t.kind} IN ('vehicle_repair','design','it_consulting','custom')`,
    ),
    check("work_types_revision", sql`${t.revision} > 0`),
  ],
);
export const workStages = pgTable(
  "work_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => workTypes.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    bucket: text("bucket").$type<"open" | "complete" | "canceled">().notNull(),
    order: integer("order").notNull(),
    isArchived: boolean("is_archived").notNull().default(false),
  },
  (t) => [
    unique("work_stages_type_key").on(t.typeId, t.key),
    unique("work_stages_id_type").on(t.id, t.typeId),
    check("work_stages_bucket", sql`${t.bucket} IN ('open','complete','canceled')`),
  ],
);
export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => workTypes.id),
    stageId: uuid("stage_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    personId: uuid("person_id").references(() => persons.id),
    dealId: uuid("deal_id").references(() => deals.id),
    dueDate: text("due_date"),
    visibility: visibilityLevelEnum("visibility").notNull().default("owner"),
    visibilityGroupId: uuid("visibility_group_id").references(() => visibilityGroups.id),
    values: jsonb("values")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    revision: integer("revision").notNull().default(1),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "work_items_stage_type",
      columns: [t.stageId, t.typeId],
      foreignColumns: [workStages.id, workStages.typeId],
    }),
    index("work_items_type_stage").on(t.typeId, t.stageId),
    index("work_items_owner").on(t.ownerId),
    check(
      "work_items_visibility_group",
      sql`(${t.visibility} = 'group') = (${t.visibilityGroupId} IS NOT NULL)`,
    ),
    check("work_items_revision", sql`${t.revision} > 0`),
  ],
);
export const workOperations = pgTable("work_operations", {
  requestId: uuid("request_id").primaryKey(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  fingerprint: text("fingerprint").notNull(),
  response: jsonb("response").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ResourceSnapshot = InstalledResource & { snapshot: unknown };
export const workInstallations = pgTable("work_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().unique(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  presetId: text("preset_id").notNull(),
  presetVersion: integer("preset_version").notNull(),
  resources: jsonb("resources").$type<ResourceSnapshot[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
});
