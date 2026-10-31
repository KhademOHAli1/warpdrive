import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { RunOutputs, StepOutput } from "@/features/workflows/runTypes";
import { users } from "./identity";
import { workflows, workflowVersions } from "./workflows";

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id),
    versionId: uuid("version_id").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestKey: uuid("request_key").notNull(),
    mode: text("mode", { enum: ["simulation", "live"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    trigger: jsonb("trigger").$type<{ recordId: string }>().notNull(),
    nextNodeId: text("next_node_id"),
    outputs: jsonb("outputs").$type<RunOutputs>().notNull().default(sql`'{}'::jsonb`),
    errorId: text("error_id"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("workflow_run_admission_unique").on(t.workflowId, t.actorId, t.requestKey),
    foreignKey({
      columns: [t.versionId, t.workflowId],
      foreignColumns: [workflowVersions.id, workflowVersions.workflowId],
      name: "workflow_run_pinned_version_fk",
    }),
    index("workflow_runs_ready_idx").on(t.status, t.createdAt),
    check(
      "workflow_runs_status_ck",
      sql`${t.status} IN ('queued','running','succeeded','failed','cancelled')`,
    ),
    check("workflow_runs_mode_ck", sql`${t.mode} IN ('simulation','live')`),
  ],
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id),
    nodeId: text("node_id").notNull(),
    simulated: boolean("simulated").notNull(),
    output: jsonb("output").$type<StepOutput>().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("workflow_step_effect_unique").on(t.runId, t.nodeId)],
);
