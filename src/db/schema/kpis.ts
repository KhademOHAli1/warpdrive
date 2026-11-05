import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  KpiDefinitionInput,
  KpiGoalInput,
  KpiGoalResult,
  KpiSchemeInput,
} from "@/features/goals/kpiModel";
import { users } from "./identity";

// Append-only revisions. Assignments reference a revision ID, never a mutable family head.
export const kpiDefinitions = pgTable(
  "kpi_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    revision: integer("revision").notNull(),
    definition: jsonb("definition").$type<KpiDefinitionInput>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("kpi_definition_revision_idx").on(t.familyId, t.revision),
    check("kpi_definition_positive_revision", sql`${t.revision}>0`),
  ],
);

export const kpiSchemes = pgTable(
  "kpi_schemes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    revision: integer("revision").notNull(),
    definition: jsonb("definition").$type<KpiSchemeInput>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("kpi_scheme_revision_idx").on(t.familyId, t.revision),
    check("kpi_scheme_positive_revision", sql`${t.revision}>0`),
  ],
);

export const kpiGoals = pgTable(
  "kpi_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => kpiDefinitions.id),
    schemeId: uuid("scheme_id").references(() => kpiSchemes.id),
    assignment: jsonb("assignment").$type<KpiGoalInput>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("kpi_goal_definition_idx").on(t.definitionId)],
);

// Manual measurements are append-only, assignment-scoped observations with provenance.
export const kpiMeasurements = pgTable(
  "kpi_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => kpiGoals.id),
    value: numeric("value", { precision: 18, scale: 4 }).notNull(),
    measuredOn: date("measured_on").notNull(),
    sourceNote: text("source_note").notNull(),
    sampleSize: integer("sample_size"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kpi_measurement_goal_date_idx").on(t.goalId, t.measuredOn),
    check("kpi_measurement_source_note", sql`length(trim(${t.sourceNote}))>=5`),
    check("kpi_measurement_sample_size", sql`${t.sampleSize}>0`),
  ],
);

// Snapshots freeze the requesting viewer's permitted result, not an asserted company total.
export const kpiSnapshots = pgTable(
  "kpi_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => kpiGoals.id),
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => users.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    result: jsonb("result").$type<KpiGoalResult>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("kpi_snapshot_viewer_period_idx").on(
      t.goalId,
      t.viewerId,
      t.periodStart,
      t.periodEnd,
    ),
    check("kpi_snapshot_period", sql`${t.periodEnd}>=${t.periodStart}`),
  ],
);
