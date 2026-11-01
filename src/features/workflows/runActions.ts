import { and, eq, isNull, TransactionRollbackError } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activityTypes, deals } from "@/db/schema";
import { createActivity } from "@/features/activities/repo";
import { type ActivityCreateInput, activityCreateInput } from "@/features/activities/schemas";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { err, ok, type Result } from "@/types/result";
import { evaluateCondition } from "./condition";
import { executableNode } from "./readiness";
import { stringBinding, uuidBinding } from "./runBindings";
import type { RunOutputs, StepOutput } from "./runTypes";
import type { WorkflowNode } from "./schemas";

function referenceActor(actor: PermSetUser) {
  return {
    userId: actor.id,
    isActive: actor.isActive,
    sessionLive: true,
    isAdmin: actor.type === "admin",
    visibilityGroupIds: [...actor.groupIds],
    managedUserIds: [...(actor.managedUserIds ?? [])],
  };
}

export async function executeRunNode(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  outputs: RunOutputs,
  trigger: { recordId: string },
  simulation: boolean,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  signal.throwIfAborted();
  if (!executableNode(node)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (node.type === "trigger.manual") return ok({ recordId: trigger.recordId });
  if (node.type === "condition") return evaluateCondition(node.config, outputs);
  if (node.type === "record.read" && node.config.entity === "deal") {
    const id = uuidBinding(node.config.recordId, outputs);
    if (!id.ok) return id;
    const allowed = await assertReferenceVisible(
      db,
      referenceActor(actor),
      { kind: "deal", id: id.value },
      signal,
    );
    if (!allowed.ok) return err(allowed.error.id);
    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, id.value), isNull(deals.deletedAt)));
    signal.throwIfAborted();
    return deal === undefined
      ? err(ERROR_IDS.DEAL_NOT_FOUND)
      : ok({
          id: deal.id,
          title: deal.title,
          ownerId: deal.ownerId,
          stageId: deal.stageId,
          status: deal.status,
          value: deal.value,
          currency: deal.currency,
        });
  }
  if (node.type === "activity.create")
    return createRunActivity(db, actor, node, outputs, simulation, signal);
  return err(ERROR_IDS.WORKFLOW_NOT_READY);
}

async function createRunActivity(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  outputs: RunOutputs,
  simulation: boolean,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  if (!can(actor, "activity.create")) return err(ERROR_IDS.PERM_DENIED);
  const subject = stringBinding(node.config.subject, outputs);
  if (!subject.ok) return subject;
  const deal =
    node.config.dealId === undefined ? ok(null) : uuidBinding(node.config.dealId, outputs);
  if (!deal.ok) return deal;
  if (deal.value !== null) {
    const allowed = await assertReferenceVisible(
      db,
      referenceActor(actor),
      { kind: "deal", id: deal.value },
      signal,
    );
    if (!allowed.ok) return err(allowed.error.id);
  }
  const [type] = await db
    .select()
    .from(activityTypes)
    .where(and(eq(activityTypes.key, "task"), isNull(activityTypes.archivedAt)));
  if (type === undefined) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const input = activityCreateInput.safeParse({
    subject: subject.value,
    dealId: deal.value,
    typeId: type.id,
  });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (simulation) return previewActivity(db, actor, input.data, signal);
  return writeActivity(db, actor, input.data, signal);
}

async function writeActivity(
  db: Db,
  actor: PermSetUser,
  input: ActivityCreateInput,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  const result = await createActivity(db, actor, input, signal, { scheduleReminder: false });
  return result.ok ? ok({ id: result.value.id }) : err(result.error.id);
}

async function previewActivity(
  db: Db,
  actor: PermSetUser,
  input: ActivityCreateInput,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  let result: Result<StepOutput, string> = err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  try {
    await db.transaction(async (preview) => {
      result = await writeActivity(preview, actor, input, signal);
      // This is a savepoint inside the run transaction. All CRM writes and database
      // notifications are rolled back; only the labeled simulation result survives.
      preview.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  return result;
}
