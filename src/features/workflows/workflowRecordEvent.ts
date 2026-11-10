import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { type Deal, deals } from "@/db/schema/deals";
import { pipelines } from "@/db/schema/pipelines";
import { workflowRecordEvents } from "@/db/schema/workflowRecordEvents";
import { toVisibleDeal } from "@/features/deals/dealAuth";
import { can } from "@/features/permissions/can";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import {
  type WorkflowRecordEventField,
  type WorkflowRecordEventKind,
  type WorkflowRecordEventSnapshot,
  workflowRecordEventFields,
  workflowRecordEventSnapshot,
} from "./workflowRecordEventContract";

export type WorkflowRecordEventTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type WorkflowRecordEvent = typeof workflowRecordEvents.$inferSelect;

type DealScope = Pick<
  Deal,
  "id" | "ownerId" | "pipelineId" | "visibilityLevel" | "visibilityGroupId" | "visibleToUserIds"
>;
export type WorkflowRecordEventDealImage = DealScope &
  Pick<Deal, WorkflowRecordEventField | "writeVersion" | "deletedAt">;

const scopeColumns = {
  id: deals.id,
  ownerId: deals.ownerId,
  pipelineId: deals.pipelineId,
  visibilityLevel: deals.visibilityLevel,
  visibilityGroupId: deals.visibilityGroupId,
  visibleToUserIds: deals.visibleToUserIds,
  writeVersion: deals.writeVersion,
  deletedAt: deals.deletedAt,
};

// A scope change never makes historical before fields visible to a new audience.
// Store a fingerprint instead of persisting historical user/visibility lists.
export function workflowRecordEventScope(deal: DealScope): string {
  return createHash("sha256")
    .update(
      [
        "warpdrive-workflow-deal-acl-v1",
        deal.id,
        deal.ownerId,
        deal.pipelineId,
        deal.visibilityLevel,
        deal.visibilityGroupId ?? "",
        [...deal.visibleToUserIds].sort().join(","),
      ].join("\n"),
    )
    .digest("hex");
}

function snapshot(deal: WorkflowRecordEventDealImage) {
  return workflowRecordEventSnapshot.safeParse({
    status: deal.status,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    value: deal.value,
    currency: deal.currency,
    expectedCloseDate: deal.expectedCloseDate,
  });
}

interface AppendInput {
  kind: WorkflowRecordEventKind;
  before: WorkflowRecordEventDealImage | null;
  // For deletion, `after` is the native returned soft-delete tombstone. Its
  // writeVersion identifies the mutation, but it never becomes an event image.
  after: WorkflowRecordEventDealImage;
}

function eventImages({ kind, before, after }: AppendInput) {
  if (
    (kind === "deleted") !== (after.deletedAt !== null) ||
    (kind === "created" && before !== null) ||
    ((kind === "updated" || kind === "deleted") && before === null) ||
    (before !== null &&
      (before.id !== after.id ||
        before.deletedAt !== null ||
        before.writeVersion === after.writeVersion))
  )
    return null;
  const previous = before === null ? null : snapshot(before);
  const next = kind === "deleted" ? null : snapshot(after);
  if (previous?.success === false || next?.success === false) return null;
  const beforeSnapshot = previous?.data ?? null;
  const afterSnapshot = next?.data ?? null;
  const changedFields =
    beforeSnapshot === null || afterSnapshot === null
      ? []
      : workflowRecordEventFields.filter((field) => beforeSnapshot[field] !== afterSnapshot[field]);
  return {
    eventId: after.writeVersion,
    recordId: after.id,
    kind,
    before: beforeSnapshot,
    after: afterSnapshot,
    beforeScope: before === null ? null : workflowRecordEventScope(before),
    afterScope: workflowRecordEventScope(after),
    changedFields,
  };
}

function sameSnapshot(
  left: WorkflowRecordEventSnapshot | null,
  right: WorkflowRecordEventSnapshot | null,
): boolean {
  return left === null || right === null
    ? left === right
    : workflowRecordEventFields.every((field) => left[field] === right[field]);
}

type EventImages = NonNullable<ReturnType<typeof eventImages>>;

function sameEvent(existing: WorkflowRecordEvent, proposed: EventImages): boolean {
  return (
    existing.recordId === proposed.recordId &&
    existing.kind === proposed.kind &&
    existing.beforeScope === proposed.beforeScope &&
    existing.afterScope === proposed.afterScope &&
    sameSnapshot(existing.before, proposed.before) &&
    sameSnapshot(existing.after, proposed.after) &&
    existing.changedFields.length === proposed.changedFields.length &&
    proposed.changedFields.every((field) => existing.changedFields.includes(field))
  );
}

async function readEvent(tx: WorkflowRecordEventTx, eventId: string, signal: AbortSignal) {
  const [event] = await tx
    .select()
    .from(workflowRecordEvents)
    .where(eq(workflowRecordEvents.eventId, eventId));
  signal.throwIfAborted();
  return event;
}

// Native producer calls this inside the Deal mutation transaction, before it
// releases the row write lock. A non-ok result must roll back that mutation.
export async function appendWorkflowRecordEvent(
  tx: WorkflowRecordEventTx,
  input: AppendInput,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const proposed = eventImages(input);
  if (proposed === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  const [current] = await tx
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, proposed.recordId), eq(deals.writeVersion, proposed.eventId)))
    .for("update");
  signal.throwIfAborted();
  if (current !== undefined) {
    const [created] = await tx
      .insert(workflowRecordEvents)
      .values(proposed)
      .onConflictDoNothing({ target: workflowRecordEvents.eventId })
      .returning({
        eventId: workflowRecordEvents.eventId,
        sequence: workflowRecordEvents.sequence,
      });
    signal.throwIfAborted();
    if (created !== undefined) return ok(created);
  }
  const existing = await readEvent(tx, proposed.eventId, signal);
  return existing !== undefined && sameEvent(existing, proposed)
    ? ok({ eventId: existing.eventId, sequence: existing.sequence })
    : err(ERROR_IDS.WORKFLOW_CONFLICT);
}

export async function lockWorkflowRecordEventDeal(
  tx: WorkflowRecordEventTx,
  recordId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const [deal] = await tx
    .select({
      ...scopeColumns,
      pipelineArchived: pipelines.isArchived,
      pipelineVisibilityGroupId: pipelines.visibilityGroupId,
    })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(eq(deals.id, recordId))
    .for("share", { of: deals });
  signal.throwIfAborted();
  return deal;
}

export type WorkflowRecordEventDealAccess = NonNullable<
  Awaited<ReturnType<typeof lockWorkflowRecordEventDeal>>
>;

export function workflowRecordEventDealVisible(
  actor: PermSetUser,
  deal: WorkflowRecordEventDealAccess,
): boolean {
  return (
    !deal.pipelineArchived && canSee(actor, toVisibleDeal(deal, deal.pipelineVisibilityGroupId))
  );
}

export function canExposeWorkflowRecordEvent(
  actor: PermSetUser,
  deal: WorkflowRecordEventDealAccess,
  event: WorkflowRecordEvent,
): boolean {
  if (event.recordId !== deal.id || !workflowRecordEventDealVisible(actor, deal)) return false;
  const scope = workflowRecordEventScope(deal);
  if (event.afterScope !== scope || (event.beforeScope !== null && event.beforeScope !== scope))
    return false;
  if (event.kind !== "deleted") return deal.deletedAt === null;
  return (
    deal.deletedAt !== null &&
    deal.writeVersion === event.eventId &&
    can(actor, "deal.delete", toVisibleDeal(deal, deal.pipelineVisibilityGroupId))
  );
}

export async function readVisibleWorkflowRecordEvent(
  tx: WorkflowRecordEventTx,
  actor: PermSetUser,
  eventId: string,
  signal: AbortSignal,
) {
  const event = await readEvent(tx, eventId, signal);
  if (event === undefined) return null;
  const deal = await lockWorkflowRecordEventDeal(tx, event.recordId, signal);
  return deal !== undefined && canExposeWorkflowRecordEvent(actor, deal, event) ? event : null;
}
