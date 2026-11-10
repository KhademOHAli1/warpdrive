import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema/workflowExecutions";
import { workflows, workflowVersions } from "@/db/schema/workflows";
import { prepareCurrentCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { validateDefinition } from "./definition";
import { executableDefinition, requiresExternalHttp, requiresHumanForm } from "./readiness";
import { definitionSchema, type WorkflowDefinition } from "./schemas";
import { readVisibleWorkflowRecordEvent, type WorkflowRecordEventTx } from "./workflowRecordEvent";
import {
  readWorkflowRecordEventLaunch,
  readWorkflowRecordEventTrigger,
  type WorkflowRecordEventLaunch,
  workflowRecordEventLaunch,
  workflowRecordEventMatches,
  workflowRecordEventOutput,
} from "./workflowRecordEventContract";

const uuid = z.uuid().toLowerCase();
const admission = z.strictObject({ workflowId: uuid, versionId: uuid, eventId: uuid });
type Admission = z.infer<typeof admission>;

export interface WorkflowRecordEventRunInsert {
  workflowId: string;
  versionId: string;
  actorId: string;
  requestKey: string;
  mode: "live";
  trigger: WorkflowRecordEventLaunch;
  nextNodeId: string;
}

export type InsertRecordEventRun = (
  tx: WorkflowRecordEventTx,
  run: WorkflowRecordEventRunInsert,
) => Promise<{ id: string } | undefined>;

export function workflowRecordEventRequestKey({
  workflowId,
  eventId,
}: Pick<Admission, "workflowId" | "eventId">): string {
  const digest = createHash("sha256")
    .update(`warpdrive.workflow.record-event.v1\n${workflowId}\n${eventId}`)
    .digest("hex");
  const variant = ((Number.parseInt(digest.charAt(16), 16) & 3) | 8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function currentPublication(
  tx: WorkflowRecordEventTx,
  input: Admission,
  signal: AbortSignal,
) {
  const [workflow] = await tx
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.id, input.workflowId),
        eq(workflows.active, true),
        isNull(workflows.archivedAt),
      ),
    )
    .for("update");
  signal.throwIfAborted();
  if (workflow === undefined || workflow.publishedNumber === null)
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const owner = await hydrateActor(tx, workflow.ownerId, signal);
  if (owner === null || !canWorkflow(owner, "run", workflow.ownerId))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const [version] = await tx
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, input.workflowId),
        eq(workflowVersions.id, input.versionId),
        eq(workflowVersions.number, workflow.publishedNumber),
      ),
    );
  signal.throwIfAborted();
  if (version === undefined) return err(ERROR_IDS.WORKFLOW_CONFLICT);
  const parsed = definitionSchema.safeParse(version.definition);
  if (!parsed.success || !executableDefinition(parsed.data))
    return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (
    (requiresExternalHttp(parsed.data) && owner.type !== "admin") ||
    (requiresHumanForm(parsed.data) && !canWorkflow(owner, "view"))
  )
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const trigger = readWorkflowRecordEventTrigger(parsed.data);
  return trigger === null
    ? err(ERROR_IDS.WORKFLOW_INVALID)
    : ok({ owner, version, definition: parsed.data, trigger });
}

async function observedRun(
  tx: WorkflowRecordEventTx,
  input: WorkflowRecordEventRunInsert,
  signal: AbortSignal,
) {
  const rows = await tx
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
  const existing = rows[0];
  if (existing === undefined) return ok(null);
  const trigger = workflowRecordEventLaunch.safeParse(existing.trigger);
  return rows.length === 1 &&
    existing.versionId === input.versionId &&
    existing.actorId === input.actorId &&
    existing.mode === "live" &&
    trigger.success &&
    trigger.data.eventId === input.trigger.eventId &&
    trigger.data.event === input.trigger.event &&
    trigger.data.recordId === input.trigger.recordId
    ? ok(existing.id)
    : err(ERROR_IDS.WORKFLOW_CONFLICT);
}

async function validDefinition(
  tx: WorkflowRecordEventTx,
  definition: WorkflowDefinition,
  signal: AbortSignal,
) {
  const defs = definition.nodes.some((node) => node.type === "activity.create")
    ? (await prepareCurrentCustomFieldValidation(tx, "activity", signal)).defs
    : [];
  return validateDefinition(definition, { status: "complete", defs }).ok;
}

// Internal event consumer. The callback writes a run in this transaction; it
// never starts a worker or enqueues a live action before the transaction commits.
export async function admitWorkflowRecordEvent(
  db: Db,
  raw: unknown,
  insertRun: InsertRecordEventRun,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const parsed = admission.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const current = await currentPublication(tx, input, signal);
    if (!current.ok) return current;
    const { owner, version, definition, trigger } = current.value;
    const event = await readVisibleWorkflowRecordEvent(tx, owner, input.eventId, signal);
    if (
      event === null ||
      event.occurredAt < version.createdAt ||
      !workflowRecordEventMatches(trigger.config, event)
    )
      return ok(null);
    const run: WorkflowRecordEventRunInsert = {
      workflowId: input.workflowId,
      versionId: input.versionId,
      actorId: owner.id,
      requestKey: workflowRecordEventRequestKey(input),
      mode: "live",
      nextNodeId: trigger.id,
      trigger: {
        kind: "record-event",
        eventId: event.eventId,
        recordId: event.recordId,
        event: event.kind,
      },
    };
    const replay = await observedRun(tx, run, signal);
    if (!replay.ok || replay.value !== null) return replay;
    if (!(await validDefinition(tx, definition, signal))) return err(ERROR_IDS.WORKFLOW_INVALID);
    const inserted = await insertRun(tx, run);
    signal.throwIfAborted();
    return inserted === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(inserted.id);
  });
}

export async function projectWorkflowRecordEventTrigger(
  tx: WorkflowRecordEventTx,
  actor: PermSetUser,
  definition: WorkflowDefinition,
  rawLaunch: unknown,
  signal: AbortSignal,
) {
  const trigger = readWorkflowRecordEventTrigger(definition);
  const launch = readWorkflowRecordEventLaunch(definition, rawLaunch);
  if (trigger === null || launch === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  const event = await readVisibleWorkflowRecordEvent(tx, actor, launch.eventId, signal);
  if (
    event === null ||
    event.recordId !== launch.recordId ||
    event.kind !== launch.event ||
    !workflowRecordEventMatches(trigger.config, event)
  )
    return err(ERROR_IDS.WORKFLOW_DENIED);
  return ok(workflowRecordEventOutput(event));
}
