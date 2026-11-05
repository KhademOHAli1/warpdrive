import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  workflowsV2,
  workflowV2Runs,
  workflowV2TriggerReceipts,
  workflowV2Waits,
} from "@/db/schema/workflowV2";
import type { BlockOutput, WorkflowV2Adapters } from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { canWorkflow } from "../access";
import { initialV2State } from "./admission";
import { publishedWorkflowV2 } from "./persistence";
import { workflowV2Readiness } from "./readiness";
import { resumeV2EventWait } from "./waits";

export interface WorkflowV2Event {
  eventKey: string;
  eventName: string;
  recordId: string;
  changedFields: string[];
  payload: BlockOutput;
  originRunId?: string | null;
  occurredAt?: string;
}
export type EventProjection = (
  db: Db,
  actor: PermSetUser,
  event: WorkflowV2Event,
  signal: AbortSignal,
) => Promise<BlockOutput | null>;
function object(value: unknown): value is BlockOutput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export async function eventChain(
  db: Db,
  workflowId: string,
  originRunId?: string | null,
): Promise<BlockOutput | null> {
  let workflowIds: string[] = [];
  let depth = 0;
  if (originRunId !== undefined && originRunId !== null) {
    const [run] = await db
      .select({ trigger: workflowV2Runs.trigger, workflowId: workflowV2Runs.workflowId })
      .from(workflowV2Runs)
      .where(eq(workflowV2Runs.id, originRunId));
    if (run === undefined) return null;
    const meta = run.trigger.$workflowV2;
    if (object(meta)) {
      workflowIds = Array.isArray(meta.workflowIds)
        ? meta.workflowIds.filter((id): id is string => typeof id === "string")
        : [];
      depth = typeof meta.depth === "number" ? meta.depth : 0;
    }
    if (!workflowIds.includes(run.workflowId)) workflowIds.push(run.workflowId);
  }
  if (workflowIds.includes(workflowId) || depth >= 8) return null;
  return { depth: depth + 1, workflowIds: [...workflowIds, workflowId] };
}
export async function admitWorkflowV2Event(
  db: Db,
  event: WorkflowV2Event,
  adapters: WorkflowV2Adapters,
  projectEvent: EventProjection,
  signal: AbortSignal,
): Promise<string[]> {
  if (
    !/^(deal|lead|person|organization|activity)\.(created|updated|deleted)$/.test(
      event.eventName,
    ) ||
    event.eventKey.length > 200
  )
    return [];
  const [objectName, action] = event.eventName.split(".");
  const rows = await db
    .select({ id: workflowsV2.id })
    .from(workflowsV2)
    .where(eq(workflowsV2.active, true));
  const ids: string[] = [];
  for (const candidate of rows) {
    signal.throwIfAborted();
    const id = await db.transaction(async (tx) => {
      const [workflow] = await tx
        .select()
        .from(workflowsV2)
        .where(eq(workflowsV2.id, candidate.id))
        .for("update");
      if (
        workflow === undefined ||
        !workflow.active ||
        workflow.archivedAt !== null ||
        workflow.publishedNumber === null
      )
        return null;
      const version = await publishedWorkflowV2(tx, workflow.id, workflow.publishedNumber);
      if (version === null) return null;
      const trigger = version.definition.trigger;
      const wanted = `record.${action}`;
      if (
        trigger.type !== wanted &&
        !(
          trigger.type === "record.created_or_updated" &&
          (action === "created" || action === "updated")
        )
      )
        return null;
      if (trigger.config.objectName !== objectName) return null;
      const actor = await hydrateActor(tx, workflow.ownerId, signal);
      if (actor === null || !canWorkflow(actor, "run", workflow.ownerId)) return null;
      const chain = await eventChain(tx, workflow.id, event.originRunId);
      if (chain === null) return null;
      const payload = await projectEvent(tx, actor, event, signal);
      if (
        payload === null ||
        (action === "updated" && !changedFieldsMatch(trigger.config.updatedFields, payload))
      )
        return null;
      const [existing] = await tx
        .select({ runId: workflowV2TriggerReceipts.runId })
        .from(workflowV2TriggerReceipts)
        .where(
          and(
            eq(workflowV2TriggerReceipts.workflowId, workflow.id),
            eq(workflowV2TriggerReceipts.eventKey, event.eventKey),
          ),
        );
      if (existing !== undefined) return existing.runId;
      const readiness = await workflowV2Readiness(tx, actor, version.definition, adapters, signal);
      if (Object.values(readiness).some((row) => row.state !== "ready")) return null;
      const [run] = await tx
        .insert(workflowV2Runs)
        .values({
          workflowId: workflow.id,
          versionId: version.id,
          actorId: actor.id,
          requestKey: crypto.randomUUID(),
          mode: "live",
          trigger: { ...payload, $workflowV2: chain },
          state: initialV2State(version.definition),
        })
        .returning({ id: workflowV2Runs.id });
      if (run === undefined) return null;
      await tx.insert(workflowV2TriggerReceipts).values({
        workflowId: workflow.id,
        versionId: version.id,
        eventKey: event.eventKey,
        payload,
        runId: run.id,
      });
      return run.id;
    });
    if (id !== null) ids.push(id);
  }
  return ids;
}
function changedFieldsMatch(
  watched: BlockOutput[string] | undefined,
  payload: BlockOutput,
): boolean {
  if (!Array.isArray(watched) || watched.length === 0) return true;
  const fields = payload.changedFields;
  return (
    Array.isArray(fields) &&
    watched.some((field) => typeof field === "string" && fields.includes(field))
  );
}
function matchesWait(wait: typeof workflowV2Waits.$inferSelect, event: WorkflowV2Event): boolean {
  if (wait.config.eventName !== event.eventName) return false;
  if (event.occurredAt !== undefined && new Date(event.occurredAt) < wait.createdAt) return false;
  if (wait.expiresAt !== null && wait.expiresAt <= new Date()) return false;
  return typeof wait.config.recordId !== "string" || wait.config.recordId === event.recordId;
}
export async function resumeWorkflowV2Event(
  db: Db,
  event: WorkflowV2Event,
  adapters: WorkflowV2Adapters,
  projectEvent: EventProjection,
  signal: AbortSignal,
): Promise<string[]> {
  const waits = await db
    .select()
    .from(workflowV2Waits)
    .where(and(eq(workflowV2Waits.kind, "event"), eq(workflowV2Waits.status, "open")));
  const ids: string[] = [];
  for (const wait of waits) {
    if (!matchesWait(wait, event)) continue;
    const [run] = await db.select().from(workflowV2Runs).where(eq(workflowV2Runs.id, wait.runId));
    if (run === undefined || run.status !== "waiting") continue;
    const actor = await hydrateActor(db, run.actorId, signal);
    if (actor === null) continue;
    const payload = await projectEvent(db, actor, event, signal);
    if (payload === null || !changedFieldsMatch(wait.config.updatedFields, payload)) continue;
    const result = await resumeV2EventWait(db, wait.id, payload, adapters, signal, event.eventKey);
    if (result.ok) ids.push(wait.runId);
  }
  return ids;
}
