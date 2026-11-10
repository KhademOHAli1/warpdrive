import { sql } from "drizzle-orm";
import {
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
import type { ErrorId } from "@/constants/errorIds";
import {
  type WorkflowExternalEffectOutput,
  workflowExternalEffectMaxOutputBytes,
  workflowExternalEffectStates,
} from "@/features/workflows/workflowExternalEffectContract";
import { workflowRuns } from "./workflowExecutions";

export const workflowExternalEffects = pgTable(
  "workflow_external_effects",
  {
    attemptId: uuid("attempt_id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id),
    nodeId: text("node_id").notNull(),
    iterationIndex: smallint("iteration_index").notNull(),
    kind: text("kind").notNull(),
    requestDigest: text("request_digest").notNull(),
    state: text("state", { enum: workflowExternalEffectStates }).notNull().default("started"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    dispatchAuthorizedAt: timestamp("dispatch_authorized_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    output: jsonb("output").$type<WorkflowExternalEffectOutput>(),
    errorId: text("error_id").$type<ErrorId>(),
  },
  (t) => [
    unique("workflow_external_effect_identity_uq").on(t.runId, t.nodeId, t.iterationIndex, t.kind),
    index("workflow_external_effect_started_idx")
      .on(t.startedAt, t.runId)
      .where(sql`${t.state} = 'started'`),
    check(
      "workflow_external_effect_identity_ck",
      sql`
      ${t.nodeId} ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' AND ${t.iterationIndex} BETWEEN -1 AND 99
      AND length(${t.kind}) <= 64 AND ${t.kind} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      AND ${t.requestDigest} ~ '^[0-9a-f]{64}$'
    `,
    ),
    check(
      "workflow_external_effect_state_ck",
      sql`
      (${t.state} = 'started' AND ${t.finishedAt} IS NULL AND ${t.output} IS NULL AND ${t.errorId} IS NULL)
      OR (${t.state} = 'complete' AND ${t.finishedAt} IS NOT NULL AND ${t.dispatchAuthorizedAt} IS NOT NULL
        AND ((${t.output} IS NOT NULL AND ${t.errorId} IS NULL) OR (${t.output} IS NULL AND ${t.errorId} IS NOT NULL)))
      OR (${t.state} = 'not_sent' AND ${t.finishedAt} IS NOT NULL AND ${t.output} IS NULL AND ${t.errorId} IS NOT NULL)
      OR (${t.state} = 'unknown' AND ${t.finishedAt} IS NOT NULL AND ${t.dispatchAuthorizedAt} IS NOT NULL
        AND ${t.output} IS NULL AND ${t.errorId} IS NOT NULL)
    `,
    ),
    check(
      "workflow_external_effect_times_ck",
      sql`
      isfinite(${t.startedAt})
      AND (${t.dispatchAuthorizedAt} IS NULL OR (isfinite(${t.dispatchAuthorizedAt}) AND ${t.dispatchAuthorizedAt} >= ${t.startedAt}))
      AND (${t.finishedAt} IS NULL OR (isfinite(${t.finishedAt}) AND ${t.finishedAt} >= coalesce(${t.dispatchAuthorizedAt}, ${t.startedAt})))
    `,
    ),
    check(
      "workflow_external_effect_output_ck",
      sql`
      (${t.errorId} IS NULL OR ${t.errorId} ~ '^E_[A-Z0-9_]+$')
      AND (${t.output} IS NULL OR (jsonb_typeof(${t.output}) = 'object'
        AND octet_length(${t.output}::text) <= ${sql.raw(String(workflowExternalEffectMaxOutputBytes))}))
    `,
    ),
  ],
);
