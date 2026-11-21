import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import { internalProjectItems } from "../schema";
import type { ProjectEstimateType, ProjectLabelKind } from "./contracts";

export const internalProjectLabels = pgTable(
  "internal_project_labels",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull(),
    kind: text("kind").$type<ProjectLabelKind>().notNull(),
    parentId: uuid("parent_id"),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ name: "internal_project_labels_pk", columns: [table.projectId, table.id] }),
    unique("internal_project_labels_assignment_key").on(table.projectId, table.id, table.kind),
    foreignKey({
      name: "internal_project_labels_project_fk",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "internal_project_labels_parent_fk",
      columns: [table.projectId, table.parentId],
      foreignColumns: [table.projectId, table.id],
    }).onDelete("restrict"),
    check(
      "internal_project_labels_kind_check",
      sql`(${table.kind} = 'group' AND ${table.parentId} IS NULL) OR (${table.kind} = 'label' AND ${table.parentId} IS DISTINCT FROM ${table.id})`,
    ),
    check(
      "internal_project_labels_content_check",
      sql`
    char_length(btrim(${table.name})) BETWEEN 1 AND 80 AND
    char_length(${table.description}) <= 2000 AND
    ${table.color} ~ '^#[a-f0-9]{6}$' AND
    ${table.position} BETWEEN 0 AND 99
  `,
    ),
    index("internal_project_labels_parent_idx").on(table.projectId, table.parentId, table.position),
  ],
);

export const internalProjectEstimateScales = pgTable(
  "internal_project_estimate_scales",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<ProjectEstimateType>().notNull(),
  },
  (table) => [
    primaryKey({
      name: "internal_project_estimate_scales_pk",
      columns: [table.projectId, table.id],
    }),
    foreignKey({
      name: "internal_project_estimate_scales_project_fk",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    check(
      "internal_project_estimate_scales_valid_check",
      sql`
    char_length(btrim(${table.name})) BETWEEN 1 AND 80 AND ${table.type} IN ('points', 'categories')
  `,
    ),
  ],
);

export const internalProjectEstimatePoints = pgTable(
  "internal_project_estimate_points",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull(),
    scaleId: uuid("scale_id").notNull(),
    value: text("value").notNull(),
    description: text("description").notNull().default(""),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({
      name: "internal_project_estimate_points_pk",
      columns: [table.projectId, table.id],
    }),
    foreignKey({
      name: "internal_project_estimate_points_scale_fk",
      columns: [table.projectId, table.scaleId],
      foreignColumns: [internalProjectEstimateScales.projectId, internalProjectEstimateScales.id],
    }).onDelete("restrict"),
    check(
      "internal_project_estimate_points_valid_check",
      sql`
    char_length(btrim(${table.value})) BETWEEN 1 AND 20 AND
    char_length(${table.description}) <= 2000 AND ${table.position} BETWEEN 0 AND 5
  `,
    ),
    index("internal_project_estimate_points_scale_idx").on(
      table.projectId,
      table.scaleId,
      table.position,
    ),
  ],
);

export const internalProjectStructureSettings = pgTable(
  "internal_project_structure_settings",
  {
    projectId: uuid("project_id").primaryKey(),
    activeScaleId: uuid("active_scale_id"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    foreignKey({
      name: "internal_project_structure_settings_project_fk",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "internal_project_structure_settings_scale_fk",
      columns: [table.projectId, table.activeScaleId],
      foreignColumns: [internalProjectEstimateScales.projectId, internalProjectEstimateScales.id],
    }).onDelete("restrict"),
    check(
      "internal_project_structure_settings_revision_check",
      sql`${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
);

export const internalProjectItemLabels = pgTable(
  "internal_project_item_labels",
  {
    projectId: uuid("project_id").notNull(),
    itemId: uuid("item_id").notNull(),
    labelId: uuid("label_id").notNull(),
    labelKind: text("label_kind").$type<"label">().notNull().default("label"),
  },
  (table) => [
    primaryKey({
      name: "internal_project_item_labels_pk",
      columns: [table.projectId, table.itemId, table.labelId],
    }),
    foreignKey({
      name: "internal_project_item_labels_item_fk",
      columns: [table.itemId, table.projectId],
      foreignColumns: [internalProjectItems.id, internalProjectItems.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "internal_project_item_labels_label_fk",
      columns: [table.projectId, table.labelId, table.labelKind],
      foreignColumns: [
        internalProjectLabels.projectId,
        internalProjectLabels.id,
        internalProjectLabels.kind,
      ],
    }).onDelete("restrict"),
    check("internal_project_item_labels_label_kind_check", sql`${table.labelKind} = 'label'`),
    index("internal_project_item_labels_catalog_idx").on(table.projectId, table.labelId),
  ],
);

export const internalProjectItemEstimates = pgTable(
  "internal_project_item_estimates",
  {
    projectId: uuid("project_id").notNull(),
    itemId: uuid("item_id").notNull(),
    pointId: uuid("point_id").notNull(),
  },
  (table) => [
    primaryKey({
      name: "internal_project_item_estimates_pk",
      columns: [table.projectId, table.itemId],
    }),
    foreignKey({
      name: "internal_project_item_estimates_item_fk",
      columns: [table.itemId, table.projectId],
      foreignColumns: [internalProjectItems.id, internalProjectItems.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "internal_project_item_estimates_point_fk",
      columns: [table.projectId, table.pointId],
      foreignColumns: [internalProjectEstimatePoints.projectId, internalProjectEstimatePoints.id],
    }).onDelete("restrict"),
    index("internal_project_item_estimates_catalog_idx").on(table.projectId, table.pointId),
  ],
);
