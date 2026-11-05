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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RunOutputs, StepOutput } from "@/features/workflows/runTypes";
import type { WorkflowManualLaunchPayload } from "@/features/workflows/workflowManualLaunchContract";
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
    status: text("status", {
      enum: ["queued", "running", "waiting", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    trigger: jsonb("trigger").$type<WorkflowManualLaunchPayload>().notNull(),
    nextNodeId: text("next_node_id"),
    resumeAt: timestamp("resume_at", { withTimezone: true }),
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
    index("workflow_runs_wait_due_idx").on(t.resumeAt, t.id).where(sql`${t.status} = 'waiting'`),
    check(
      "workflow_runs_status_ck",
      sql`${t.status} IN ('queued','running','waiting','succeeded','failed','cancelled')`,
    ),
    check(
      "workflow_runs_wait_state_ck",
      sql`(${t.status} = 'waiting' AND ${t.resumeAt} IS NOT NULL AND isfinite(${t.resumeAt}) AND ${t.nextNodeId} IS NOT NULL)
        OR (${t.status} <> 'waiting' AND ${t.resumeAt} IS NULL)`,
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

// Failure facts survive recovery. A retry consumes one exact generation, never a
// later failure or the original run admission key. Users are soft-deactivated;
// keep the same restrictive identity references as the run and its effects.
export const workflowRunFailures = pgTable(
  "workflow_run_failures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id),
    nodeId: text("node_id"),
    errorId: text("error_id").notNull(),
    failedAt: timestamp("failed_at", { withTimezone: true }).notNull(),
    origin: text("origin", { enum: ["recorded", "legacy_snapshot"] })
      .notNull()
      .default("recorded"),
    originalResumeAt: timestamp("original_resume_at", { withTimezone: true }),
    retryRequestKey: uuid("retry_request_key"),
    retriedBy: uuid("retried_by").references(() => users.id),
    retriedAt: timestamp("retried_at", { withTimezone: true }),
  },
  (t) => [
    unique("workflow_run_retry_request_unique").on(t.retriedBy, t.retryRequestKey),
    uniqueIndex("workflow_run_open_failure_unique").on(t.runId).where(sql`${t.retriedAt} IS NULL`),
    index("workflow_run_failures_history_idx").on(t.runId, t.failedAt),
    check(
      "workflow_run_failure_retry_receipt_ck",
      sql`(${t.retryRequestKey} IS NULL AND ${t.retriedBy} IS NULL AND ${t.retriedAt} IS NULL)
        OR (${t.retryRequestKey} IS NOT NULL AND ${t.retriedBy} IS NOT NULL AND ${t.retriedAt} IS NOT NULL)`,
    ),
    check(
      "workflow_run_failure_deadline_ck",
      sql`${t.originalResumeAt} IS NULL OR isfinite(${t.originalResumeAt})`,
    ),
    check("workflow_run_failure_origin_ck", sql`${t.origin} IN ('recorded','legacy_snapshot')`),
    check(
      "workflow_run_failure_times_ck",
      sql`isfinite(${t.failedAt}) AND (${t.retriedAt} IS NULL OR isfinite(${t.retriedAt}))`,
    ),
  ],
);
