import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type WorkflowRecordEventField,
  type WorkflowRecordEventSnapshot,
  workflowRecordEventKinds,
} from "@/features/workflows/workflowRecordEventContract";
import { workflowRuns } from "./workflowExecutions";

const watchedFieldCheck = sql`ARRAY['status','pipelineId','stageId','value','currency','expectedCloseDate']::text[]`;

export const workflowRecordEvents = pgTable(
  "workflow_record_events",
  {
    eventId: uuid("event_id").primaryKey(),
    sequence: bigint("sequence", { mode: "bigint" }).generatedAlwaysAsIdentity().notNull(),
    recordId: uuid("record_id").notNull(),
    kind: text("kind", { enum: workflowRecordEventKinds }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    before: jsonb("before_snapshot").$type<WorkflowRecordEventSnapshot>(),
    after: jsonb("after_snapshot").$type<WorkflowRecordEventSnapshot>(),
    beforeScope: text("before_scope"),
    afterScope: text("after_scope").notNull(),
    changedFields: text("changed_fields").array().$type<WorkflowRecordEventField[]>().notNull(),
  },
  (t) => [
    unique("workflow_record_event_sequence_uq").on(t.sequence),
    index("workflow_record_event_record_seq_idx").on(t.recordId, t.sequence),
    check(
      "workflow_record_event_scope_ck",
      sql`
    (${t.beforeScope} IS NULL OR ${t.beforeScope} ~ '^[a-f0-9]{64}$')
    AND ${t.afterScope} ~ '^[a-f0-9]{64}$'
    AND ((${t.before} IS NULL AND ${t.beforeScope} IS NULL) OR (${t.before} IS NOT NULL AND ${t.beforeScope} IS NOT NULL))
  `,
    ),
    check(
      "workflow_record_event_images_ck",
      sql`
    (${t.kind} = 'created' AND ${t.before} IS NULL AND ${t.after} IS NOT NULL)
    OR (${t.kind} = 'updated' AND ${t.before} IS NOT NULL AND ${t.after} IS NOT NULL)
    OR (${t.kind} = 'deleted' AND ${t.before} IS NOT NULL AND ${t.after} IS NULL)
    OR (${t.kind} = 'upserted' AND ${t.after} IS NOT NULL)
  `,
    ),
    check(
      "workflow_record_event_values_ck",
      sql`
    ${t.sequence} > 0 AND isfinite(${t.occurredAt})
    AND (${t.before} IS NULL OR (jsonb_typeof(${t.before}) = 'object' AND octet_length(${t.before}::text) <= 1024))
    AND (${t.after} IS NULL OR (jsonb_typeof(${t.after}) = 'object' AND octet_length(${t.after}::text) <= 1024))
    AND ${t.changedFields} <@ ${watchedFieldCheck} AND cardinality(${t.changedFields}) <= 6
  `,
    ),
  ],
);

export const workflowRecordEventWaits = pgTable(
  "workflow_record_event_waits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id),
    nodeId: text("node_id").notNull(),
    iterationIndex: smallint("iteration_index").notNull(),
    recordId: uuid("record_id").notNull(),
    kind: text("kind", { enum: workflowRecordEventKinds }).notNull(),
    watchedFields: text("watched_fields").array().$type<WorkflowRecordEventField[]>().notNull(),
    afterSequence: bigint("after_sequence", { mode: "bigint" }).notNull(),
    armedAt: timestamp("armed_at", { withTimezone: true }).notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    state: text("state", { enum: ["waiting", "event", "timed_out"] })
      .notNull()
      .default("waiting"),
    matchedEventId: uuid("matched_event_id").references(() => workflowRecordEvents.eventId),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("workflow_record_event_wait_identity_uq").on(t.runId, t.nodeId, t.iterationIndex),
    index("workflow_record_event_wait_record_idx")
      .on(t.recordId, t.kind, t.deadline)
      .where(sql`${t.state} = 'waiting'`),
    check(
      "workflow_record_event_wait_scope_ck",
      sql`
    ${t.nodeId} ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' AND ${t.iterationIndex} BETWEEN -1 AND 99
    AND ${t.kind} IN ('created','updated','deleted','upserted')
    AND ${t.afterSequence} >= 0 AND isfinite(${t.armedAt}) AND isfinite(${t.deadline}) AND ${t.deadline} > ${t.armedAt}
    AND ${t.watchedFields} <@ ${watchedFieldCheck} AND cardinality(${t.watchedFields}) <= 6
  `,
    ),
    check(
      "workflow_record_event_wait_state_ck",
      sql`
    (${t.state} = 'waiting' AND ${t.matchedEventId} IS NULL AND ${t.finishedAt} IS NULL)
    OR (${t.state} = 'event' AND ${t.matchedEventId} IS NOT NULL AND ${t.finishedAt} IS NOT NULL)
    OR (${t.state} = 'timed_out' AND ${t.matchedEventId} IS NULL AND ${t.finishedAt} IS NOT NULL)
  `,
    ),
    check(
      "workflow_record_event_wait_finished_ck",
      sql`
    ${t.finishedAt} IS NULL OR (isfinite(${t.finishedAt}) AND ${t.finishedAt} >= ${t.armedAt})
  `,
    ),
  ],
);
