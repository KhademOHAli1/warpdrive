import { and, eq, isNull, TransactionRollbackError } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activityTypes, deals } from "@/db/schema";
import { createActivity } from "@/features/activities/repo";
import { type ActivityCreateInput, activityCreateInput } from "@/features/activities/schemas";
import {
  type PreparedCustomFieldValidation,
  prepareCurrentCustomFieldValidation,
} from "@/features/custom-fields/currentValidation";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { err, ok, type Result } from "@/types/result";
import { evaluateCondition } from "./condition";
import { resolveTaskCustomFields } from "./configurationRuntime";
import { validateNodeConfiguration } from "./configurationValidation";
import { evaluateFilter } from "./filter";
import { evaluateIfElse } from "./ifElse";
import { validateLiteralIntent } from "./mappingLiteralIntent";
import { executableNode } from "./readiness";
import { stringBinding, uuidBinding } from "./runBindings";
import type { RunOutputs, StepOutput } from "./runTypes";
import { bindingSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";
import { createWorkflowCalendarEvent } from "./workflowCalendarEvent";
import { createWorkflowEmailDraft } from "./workflowEmailDraft";
import { matchWorkflowManualLaunch } from "./workflowManualLaunchContract";
import { upsertWorkflowPerson } from "./workflowPersonUpsert";
import { createWorkflowRecord } from "./workflowRecordCreate";
import { mutateWorkflowRecord } from "./workflowRecordMutation";
import { pickWorkflowRecord } from "./workflowRecordPick";
import { searchWorkflowRecords } from "./workflowRecordQuery";
import type { WorkflowRunLaunchPayload } from "./workflowRunLaunchContract";
import { readWorkflowScheduleLaunch } from "./workflowScheduleContract";

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

function executeTriggerStep(
  node: WorkflowNode,
  definition: WorkflowDefinition,
  trigger: WorkflowRunLaunchPayload,
): Result<StepOutput, string> {
  if (node.type === "trigger.schedule")
    return readWorkflowScheduleLaunch(definition, trigger) === null
      ? err(ERROR_IDS.WORKFLOW_INVALID)
      : ok({});
  const launch = matchWorkflowManualLaunch(node.config, trigger);
  if (launch === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok("recordId" in launch ? { recordId: launch.recordId } : {});
}

export async function executeRunNode(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  outputs: RunOutputs,
  trigger: WorkflowRunLaunchPayload,
  simulation: boolean,
  definition: WorkflowDefinition,
  signal: AbortSignal,
  scope?: { runId: string; workflowId: string },
): Promise<Result<StepOutput, string>> {
  signal.throwIfAborted();
  if (!executableNode(node)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const mode = simulation ? "simulation" : "live";
  switch (node.type) {
    case "trigger.manual":
    case "trigger.schedule":
      return executeTriggerStep(node, definition, trigger);
    case "filter":
      return evaluateFilter(node.config, outputs, { definition, nodeId: node.id });
    case "ifElse":
      return evaluateIfElse(node.config, outputs, { definition, nodeId: node.id });
    case "record.create":
      return createWorkflowRecord(db, actor, node, outputs, definition, mode, signal);
    case "record.update":
    case "record.delete":
      return mutateWorkflowRecord(db, actor, node, outputs, definition, mode, signal);
    case "record.search":
      return searchWorkflowRecords(db, actor, node, outputs, definition, signal);
    case "record.upsert":
      return scope === undefined
        ? err(ERROR_IDS.WORKFLOW_INVALID)
        : upsertWorkflowPerson(
            db,
            actor,
            node,
            outputs,
            definition,
            { workflowId: scope.workflowId, mode },
            signal,
          );
    case "record.pick":
      return scope === undefined
        ? err(ERROR_IDS.WORKFLOW_INVALID)
        : pickWorkflowRecord(db, actor, node, { workflowId: scope.workflowId, simulation }, signal);
    case "calendar.create":
      return createWorkflowCalendarEvent(db, actor, node, outputs, definition, mode, signal);
    case "email.draft":
      return scope === undefined
        ? err(ERROR_IDS.WORKFLOW_INVALID)
        : createWorkflowEmailDraft(
            db,
            actor,
            node,
            outputs,
            definition,
            { mode, runId: scope.runId },
            signal,
          );
    case "condition":
      return evaluateCondition(node.config, outputs, { definition, nodeId: node.id });
    case "record.read":
      return node.config.entity === "deal"
        ? readRunDeal(db, actor, node, outputs, definition, signal)
        : err(ERROR_IDS.WORKFLOW_NOT_READY);
    case "activity.create":
      return createRunActivity(db, actor, node, outputs, simulation, definition, signal);
    case "http.request":
    case "delay":
    case "iterator":
    case "human.form":
    case "notification":
    case "trigger.record":
      return err(ERROR_IDS.WORKFLOW_NOT_READY);
  }
}

async function readRunDeal(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  const id = uuidBinding(node.config.recordId, outputs, {
    definition,
    nodeId: node.id,
    path: ["recordId"],
  });
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
  if (deal === undefined) return err(ERROR_IDS.DEAL_NOT_FOUND);
  if (
    deal.expectedCloseDate !== null &&
    validateLiteralIntent({ kind: "value", value: deal.expectedCloseDate, literalType: "date" }) !==
      null
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok({
    id: deal.id,
    title: deal.title,
    ownerId: deal.ownerId,
    stageId: deal.stageId,
    status: deal.status,
    value: deal.value,
    currency: deal.currency,
    expectedCloseDate: deal.expectedCloseDate,
  });
}

async function createRunActivity(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  outputs: RunOutputs,
  simulation: boolean,
  definition: WorkflowDefinition,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  if (!can(actor, "activity.create")) return err(ERROR_IDS.PERM_DENIED);
  const subject = stringBinding(node.config.subject, outputs, {
    definition,
    nodeId: node.id,
    path: ["subject"],
  });
  if (!subject.ok) return subject;
  const linked = bindingSchema.safeParse(node.config.dealId);
  const noDeal =
    node.config.dealId === undefined ||
    (linked.success && linked.data.kind === "value" && linked.data.value === null);
  const deal = noDeal
    ? ok(null)
    : uuidBinding(node.config.dealId, outputs, { definition, nodeId: node.id, path: ["dealId"] });
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
  const customFieldValidation = await prepareCurrentCustomFieldValidation(db, "activity", signal);
  if (
    validateNodeConfiguration(node, {
      definition,
      metadata: { status: "complete", defs: customFieldValidation.defs },
    }).status !== "valid"
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const customFields = await resolveTaskCustomFields(
    db,
    actor,
    node,
    { outputs, definition },
    customFieldValidation,
    signal,
  );
  if (!customFields.ok) return err(customFields.error.id);
  const input = activityCreateInput.safeParse({
    customFields: customFields.value,
    subject: subject.value,
    dealId: deal.value,
    typeId: type.id,
  });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (simulation) return previewActivity(db, actor, input.data, customFieldValidation, signal);
  return writeActivity(db, actor, input.data, customFieldValidation, signal);
}

async function writeActivity(
  db: Db,
  actor: PermSetUser,
  input: ActivityCreateInput,
  customFieldValidation: PreparedCustomFieldValidation,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  const result = await createActivity(db, actor, input, signal, {
    scheduleReminder: false,
    customFieldValidation,
  });
  return result.ok ? ok({ id: result.value.id }) : err(result.error.id);
}

async function previewActivity(
  db: Db,
  actor: PermSetUser,
  input: ActivityCreateInput,
  customFieldValidation: PreparedCustomFieldValidation,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  let result: Result<StepOutput, string> = err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  try {
    await db.transaction(async (preview) => {
      result = await writeActivity(preview, actor, input, customFieldValidation, signal);
      // This is a savepoint inside the run transaction. All CRM writes and database
      // notifications are rolled back; only the labeled simulation result survives.
      preview.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  return result;
}
