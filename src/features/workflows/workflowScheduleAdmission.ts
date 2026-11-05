import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows, workflowVersions } from "@/db/schema";
import { prepareCurrentCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { validateDefinition } from "./definition";
import { executableDefinition } from "./readiness";
import { definitionSchema, type WorkflowDefinition } from "./schemas";
import {
  readWorkflowScheduleTrigger,
  type WorkflowSchedulePayload,
  workflowScheduledAt,
  workflowScheduleMatches,
  workflowScheduleMinute,
  workflowSchedulePayload,
} from "./workflowScheduleContract";

const uuid = z.uuid().toLowerCase();
const occurrenceSchema = z.strictObject({
  workflowId: uuid,
  versionId: uuid,
  scheduledAt: workflowScheduledAt,
});
export type WorkflowScheduleOccurrence = z.infer<typeof occurrenceSchema>;

type WorkflowTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface WorkflowScheduleRunInsert {
  workflowId: string;
  versionId: string;
  actorId: string;
  requestKey: string;
  mode: "live";
  trigger: WorkflowSchedulePayload;
  nextNodeId: string;
}

export type InsertScheduledWorkflowRun = (
  tx: WorkflowTx,
  input: WorkflowScheduleRunInsert,
) => Promise<{ id: string } | undefined>;

export function workflowScheduleRequestKey(
  input: Pick<WorkflowScheduleOccurrence, "workflowId" | "scheduledAt">,
): string {
  const digest = createHash("sha256")
    .update(`warpdrive.workflow.schedule.v1\n${input.workflowId}\n${input.scheduledAt}`)
    .digest("hex");
  const variant = ((Number.parseInt(digest.charAt(16), 16) & 3) | 8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function lockScheduledWorkflow(tx: WorkflowTx, workflowId: string, signal: AbortSignal) {
  const [workflow] = await tx
    .select({ ownerId: workflows.ownerId, publishedNumber: workflows.publishedNumber })
    .from(workflows)
    .where(
      and(eq(workflows.id, workflowId), eq(workflows.active, true), isNull(workflows.archivedAt)),
    )
    .for("update");
  signal.throwIfAborted();
  if (workflow === undefined || workflow.publishedNumber === null) return null;
  const owner = await hydrateActor(tx, workflow.ownerId, signal);
  if (
    owner === null ||
    owner.id !== workflow.ownerId ||
    !canWorkflow(owner, "run", workflow.ownerId)
  )
    return null;
  return { owner, publishedNumber: workflow.publishedNumber };
}

async function pinnedScheduledDefinition(
  tx: WorkflowTx,
  input: WorkflowScheduleOccurrence,
  currentNumber: number,
  signal: AbortSignal,
) {
  const [publication] = await tx
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.id, input.versionId),
        eq(workflowVersions.workflowId, input.workflowId),
        eq(workflowVersions.number, currentNumber),
      ),
    );
  signal.throwIfAborted();
  if (publication === undefined) return err(ERROR_IDS.WORKFLOW_CONFLICT);
  const parsed = definitionSchema.safeParse(publication.definition);
  if (!parsed.success || !executableDefinition(parsed.data))
    return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const trigger = readWorkflowScheduleTrigger(parsed.data);
  if (trigger === null || !workflowScheduleMatches(trigger.config, input.scheduledAt))
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (publication.createdAt.getTime() > Date.parse(input.scheduledAt))
    return err(ERROR_IDS.WORKFLOW_NOT_READY);
  return ok({ definition: parsed.data, triggerId: trigger.id });
}

async function findScheduledReplay(
  tx: WorkflowTx,
  input: WorkflowScheduleRunInsert,
  signal: AbortSignal,
) {
  // The workflow row lock serializes all admissions for this workflow, so the
  // lookup also fences future owner changes despite the actor-scoped DB key.
  const receipts = await tx
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.requestKey, input.requestKey),
      ),
    )
    .limit(2);
  signal.throwIfAborted();
  const existing = receipts[0];
  if (existing === undefined) return ok(null);
  const payload = workflowSchedulePayload.safeParse(existing.trigger);
  if (
    receipts.length !== 1 ||
    existing.versionId !== input.versionId ||
    existing.actorId !== input.actorId ||
    existing.mode !== input.mode ||
    !payload.success ||
    payload.data.scheduledAt !== input.trigger.scheduledAt
  )
    return err(ERROR_IDS.WORKFLOW_CONFLICT);
  return ok(existing.id);
}

async function validateScheduledDefinition(
  tx: WorkflowTx,
  definition: WorkflowDefinition,
  signal: AbortSignal,
) {
  const defs = definition.nodes.some((node) => node.type === "activity.create")
    ? (await prepareCurrentCustomFieldValidation(tx, "activity", signal)).defs
    : [];
  return validateDefinition(definition, { status: "complete", defs }).ok;
}

async function insertDueScheduledRun(
  tx: WorkflowTx,
  run: WorkflowScheduleRunInsert,
  insertRun: InsertScheduledWorkflowRun,
  signal: AbortSignal,
) {
  // A fresh occurrence can start only in its current database UTC minute.
  // A delayed delivery can replay an existing receipt without new effects.
  const clock = await tx.execute<{ milliseconds: number }>(
    sql`SELECT extract(epoch from clock_timestamp())::double precision * 1000 AS milliseconds`,
  );
  signal.throwIfAborted();
  const minute = workflowScheduleMinute(clock.rows[0]?.milliseconds ?? Number.NaN);
  if (minute === null) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  if (minute !== run.trigger.scheduledAt) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const inserted = await insertRun(tx, run);
  signal.throwIfAborted();
  return inserted === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(inserted.id);
}

// Private scheduler entry point. The callback inserts through this transaction;
// it never enqueues. Nudge an admitted ID only after this promise resolves.
export async function admitScheduledWorkflowOccurrence(
  db: Db,
  raw: unknown,
  insertRun: InsertScheduledWorkflowRun,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const parsed = occurrenceSchema.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const current = await lockScheduledWorkflow(tx, input.workflowId, signal);
    if (current === null) return err(ERROR_IDS.WORKFLOW_DENIED);
    const pinned = await pinnedScheduledDefinition(tx, input, current.publishedNumber, signal);
    if (!pinned.ok) return pinned;
    if (
      pinned.value.definition.nodes.some((node) => node.type === "human.form") &&
      !canWorkflow(current.owner, "view")
    )
      return err(ERROR_IDS.WORKFLOW_DENIED);
    const run: WorkflowScheduleRunInsert = {
      workflowId: input.workflowId,
      versionId: input.versionId,
      actorId: current.owner.id,
      requestKey: workflowScheduleRequestKey(input),
      mode: "live",
      trigger: { scope: "schedule", scheduledAt: input.scheduledAt },
      nextNodeId: pinned.value.triggerId,
    };
    const replay = await findScheduledReplay(tx, run, signal);
    if (!replay.ok) return replay;
    if (replay.value !== null) return ok(replay.value);
    if (!(await validateScheduledDefinition(tx, pinned.value.definition, signal)))
      return err(ERROR_IDS.WORKFLOW_INVALID);
    return insertDueScheduledRun(tx, run, insertRun, signal);
  });
}
