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
import type {
  BlockOutput,
  WorkflowV2Definition,
  WorkflowV2RunState,
} from "@/features/blocks/contracts";
import { users } from "./identity";

export const workflowsV2 = pgTable(
  "workflows_v2",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(1),
    draft: jsonb("draft").$type<WorkflowV2Definition>().notNull(),
    runtimeState: jsonb("runtime_state").$type<Record<string, number>>().notNull().default({}),
    publishedNumber: integer("published_number"),
    active: boolean("active").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workflows_v2_owner_idx").on(t.ownerId),
    check("workflows_v2_revision_positive", sql`${t.revision}>0`),
    check(
      "workflows_v2_active_published",
      sql`NOT ${t.active} OR (${t.publishedNumber} IS NOT NULL AND ${t.archivedAt} IS NULL)`,
    ),
  ],
);
export const workflowV2Versions = pgTable(
  "workflow_v2_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflowsV2.id),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<WorkflowV2Definition>().notNull(),
    publishedBy: uuid("published_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("workflow_v2_version_number_unique").on(t.workflowId, t.number),
    unique("workflow_v2_version_identity_unique").on(t.id, t.workflowId),
    check("workflow_v2_version_positive", sql`${t.number}>0`),
  ],
);
export const workflowV2Runs = pgTable(
  "workflow_v2_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflowsV2.id),
    versionId: uuid("version_id").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestKey: uuid("request_key").notNull(),
    mode: text("mode").$type<"test" | "live">().notNull(),
    status: text("status")
      .$type<"queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled">()
      .notNull()
      .default("queued"),
    state: jsonb("state").$type<WorkflowV2RunState>().notNull(),
    trigger: jsonb("trigger").$type<BlockOutput>().notNull(),
    errorId: text("error_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.versionId, t.workflowId],
      foreignColumns: [workflowV2Versions.id, workflowV2Versions.workflowId],
      name: "workflow_v2_run_pinned_version",
    }),
    unique("workflow_v2_run_request_unique").on(t.workflowId, t.actorId, t.requestKey),
    index("workflow_v2_run_status_idx").on(t.status, t.updatedAt),
    check(
      "workflow_v2_run_status",
      sql`${t.status} IN ('queued','running','waiting','succeeded','failed','cancelled')`,
    ),
    check("workflow_v2_run_mode", sql`${t.mode} IN ('test','live')`),
  ],
);
export const workflowV2Executions = pgTable(
  "workflow_v2_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowV2Runs.id),
    nodeId: text("node_id").notNull(),
    visitKey: text("visit_key").notNull(),
    framePath: jsonb("frame_path").$type<string[]>().notNull(),
    status: text("status").$type<"running" | "waiting" | "completed" | "failed">().notNull(),
    output: jsonb("output").$type<BlockOutput>(),
    errorId: text("error_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    unique("workflow_v2_execution_visit_unique").on(t.runId, t.visitKey),
    check(
      "workflow_v2_execution_status",
      sql`${t.status} IN ('running','waiting','completed','failed')`,
    ),
  ],
);
export const workflowV2Waits = pgTable(
  "workflow_v2_waits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowV2Runs.id),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => workflowV2Executions.id),
    kind: text("kind").$type<"delay" | "form" | "event" | "chat">().notNull(),
    status: text("status")
      .$type<"open" | "resumed" | "expired" | "cancelled">()
      .notNull()
      .default("open"),
    responderId: uuid("responder_id").references(() => users.id),
    wakeAt: timestamp("wake_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    config: jsonb("config").$type<BlockOutput>().notNull(),
    output: jsonb("output").$type<BlockOutput>(),
    receiptKey: text("receipt_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
  },
  (t) => [
    unique("workflow_v2_wait_execution_unique").on(t.executionId),
    index("workflow_v2_wait_due_idx").on(t.status, t.wakeAt, t.expiresAt),
    check("workflow_v2_wait_kind", sql`${t.kind} IN ('delay','form','event','chat')`),
    check("workflow_v2_wait_status", sql`${t.status} IN ('open','resumed','expired','cancelled')`),
  ],
);
export const workflowV2Effects = pgTable(
  "workflow_v2_effects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowV2Runs.id),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => workflowV2Executions.id),
    effectKey: uuid("effect_key").defaultRandom().notNull(),
    status: text("status")
      .$type<"prepared" | "claimed" | "applied" | "failed" | "unknown">()
      .notNull()
      .default("prepared"),
    request: jsonb("request").$type<BlockOutput>().notNull(),
    output: jsonb("output").$type<BlockOutput>(),
    errorId: text("error_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("workflow_v2_effect_execution_unique").on(t.executionId),
    unique("workflow_v2_effect_key_unique").on(t.effectKey),
    check(
      "workflow_v2_effect_status",
      sql`${t.status} IN ('prepared','claimed','applied','failed','unknown')`,
    ),
  ],
);
export const workflowV2TriggerReceipts = pgTable(
  "workflow_v2_trigger_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflowsV2.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => workflowV2Versions.id),
    eventKey: text("event_key").notNull(),
    payload: jsonb("payload").$type<BlockOutput>().notNull(),
    runId: uuid("run_id").references(() => workflowV2Runs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("workflow_v2_trigger_event_unique").on(t.workflowId, t.eventKey)],
);
