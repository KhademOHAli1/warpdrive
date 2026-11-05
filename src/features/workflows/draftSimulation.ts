import { createHash } from "node:crypto";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { prepareCurrentCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import { validateDefinition } from "./definition";
import { delayScheduleAt } from "./delay";
import {
  draftSimulationInputLimits,
  type PreparedDraftSimulationInput,
  prepareDraftSimulationInput,
} from "./draftSimulationInput";
import {
  type DraftSimulationErrorId,
  type DraftSimulationNodeType,
  type DraftSimulationReceipt,
  type DraftSimulationStep,
  draftSimulationNodeTypes,
} from "./draftSimulationReceipt";
import { lockWorkflowForCommand } from "./lifecycleShared";
import { draftExecutableNode } from "./readiness";
import { executeRunNode } from "./runActions";
import { selectRunBranch } from "./runBranchSelection";
import type { RunOutputs, StepOutput } from "./runTypes";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./schemas";
import { createWorkflowEmailDraft } from "./workflowEmailDraft";
import { createWorkflowRecord } from "./workflowRecordCreate";
import { mutateWorkflowRecord } from "./workflowRecordMutation";
import { pickWorkflowRecord } from "./workflowRecordPick";

type DraftNode = WorkflowNode & { type: DraftSimulationNodeType };
interface SimulationContext {
  db: Db;
  actor: PermSetUser;
  workflowId: string;
  recordId: string;
  definition: WorkflowDefinition;
  signal: AbortSignal;
}
interface SuccessfulStep {
  output: StepOutput;
  receipt: DraftSimulationStep;
  nextId: string | undefined;
}

function supportedNode(node: WorkflowNode): node is DraftNode {
  return draftSimulationNodeTypes.some((type) => type === node.type) && draftExecutableNode(node);
}

function knownErrorId(value: string): value is DraftSimulationErrorId {
  return Object.values(ERROR_IDS).some((id) => id === value);
}

function safeErrorId(value: string): DraftSimulationErrorId {
  return knownErrorId(value) ? value : ERROR_IDS.WORKFLOW_WRITE_FAILED;
}

function failedStep(node: DraftNode, error: string): DraftSimulationStep {
  return {
    nodeId: node.id,
    nodeType: node.type,
    status: "failed",
    errorId: safeErrorId(error),
  };
}

function succeededStep(
  node: DraftNode,
  output: StepOutput,
  next: WorkflowEdge | undefined,
): DraftSimulationStep {
  const receipt: DraftSimulationStep = {
    nodeId: node.id,
    nodeType: node.type,
    status: "succeeded",
  };
  if (next !== undefined) receipt.port = next.port;
  if (node.type === "record.delete" && output.deleted === true) receipt.recordDeleted = true;
  if (node.type === "delay" && typeof output.resumeAt === "string")
    receipt.waitResumeAt = output.resumeAt;
  return receipt;
}

async function currentDraftAuthority(
  db: Db,
  actor: PermSetUser,
  workflowId: string,
  signal: AbortSignal,
) {
  const locked = await lockWorkflowForCommand(db, actor, workflowId, "edit", signal);
  if (!locked.ok) return locked;
  const { workflow, actor: currentActor } = locked.value;
  if (workflow.archivedAt !== null || !canWorkflow(currentActor, "run", workflow.ownerId))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  return locked;
}

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

async function currentDefinition(db: Db, definition: WorkflowDefinition, signal: AbortSignal) {
  const metadata = definition.nodes.some((node) => node.type === "activity.create")
    ? {
        status: "complete" as const,
        defs: (await prepareCurrentCustomFieldValidation(db, "activity", signal)).defs,
      }
    : { status: "complete" as const, defs: [] };
  const checked = validateDefinition(definition, metadata);
  if (!checked.ok) return err(ERROR_IDS.WORKFLOW_INVALID);
  return checked.value.nodes.every(supportedNode)
    ? ok(checked.value)
    : err(ERROR_IDS.WORKFLOW_NOT_READY);
}

async function stepClock(db: Db, signal: AbortSignal): Promise<Result<Date, string>> {
  const clock = await db.execute<{ milliseconds: number }>(
    sql.raw(
      "SELECT extract(epoch from clock_timestamp())::double precision * 1000 AS milliseconds",
    ),
  );
  signal.throwIfAborted();
  const now = new Date(clock.rows[0]?.milliseconds ?? Number.NaN);
  return Number.isFinite(now.getTime()) ? ok(now) : err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
}

async function executeDraftNode(
  context: SimulationContext,
  actor: PermSetUser,
  node: DraftNode,
  outputs: RunOutputs,
  now: Date,
): Promise<Result<StepOutput, string>> {
  if (node.type === "delay") {
    const projected = delayScheduleAt(node.config, now, {
      definition: context.definition,
      nodeId: node.id,
      outputs,
    });
    return projected.ok ? ok({ resumeAt: projected.value.toISOString() }) : projected;
  }
  if (node.type === "record.create")
    return createWorkflowRecord(
      context.db,
      actor,
      node,
      outputs,
      context.definition,
      "draft-simulation",
      context.signal,
    );
  if (node.type === "record.update" || node.type === "record.delete")
    return mutateWorkflowRecord(
      context.db,
      actor,
      node,
      outputs,
      context.definition,
      "draft-simulation",
      context.signal,
    );
  if (node.type === "record.pick")
    return pickWorkflowRecord(
      context.db,
      actor,
      node,
      { workflowId: context.workflowId, simulation: true },
      context.signal,
    );
  if (node.type === "email.draft")
    return createWorkflowEmailDraft(
      context.db,
      actor,
      node,
      outputs,
      context.definition,
      { mode: "draft-simulation" },
      context.signal,
    );
  return executeRunNode(
    context.db,
    actor,
    node,
    outputs,
    { recordId: context.recordId },
    true,
    context.definition,
    context.signal,
  );
}

async function simulateStep(
  context: SimulationContext,
  actor: PermSetUser,
  node: DraftNode,
  outputs: RunOutputs,
): Promise<Result<SuccessfulStep, DraftSimulationStep>> {
  const clock = await stepClock(context.db, context.signal);
  if (!clock.ok) return err(failedStep(node, clock.error));
  const executed = await executeDraftNode(context, actor, node, outputs, clock.value);
  context.signal.throwIfAborted();
  if (!executed.ok) return err(failedStep(node, executed.error));
  const selected = selectRunBranch(context.definition, node, executed.value);
  if (!selected.ok) return err(failedStep(node, selected.error));
  return ok({
    output: executed.value,
    receipt: succeededStep(node, executed.value, selected.value),
    nextId: selected.value?.to,
  });
}

async function walkDraft(
  context: SimulationContext,
  receipt: DraftSimulationReceipt,
): Promise<Result<DraftSimulationReceipt, string>> {
  const start = context.definition.nodes.find((node) => node.type === "trigger.manual");
  if (start === undefined) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const nodes = new Map(context.definition.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const outputs: RunOutputs = {};
  let cursor: string | undefined = start.id;
  while (cursor !== undefined) {
    context.signal.throwIfAborted();
    if (visited.size >= 100 || visited.has(cursor)) return err(ERROR_IDS.WORKFLOW_INVALID);
    visited.add(cursor);
    const node = nodes.get(cursor);
    if (node === undefined || !supportedNode(node)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
    const authority = await currentDraftAuthority(
      context.db,
      context.actor,
      context.workflowId,
      context.signal,
    );
    if (!authority.ok) return authority;
    const step = await simulateStep(context, authority.value.actor, node, outputs);
    if (!step.ok) {
      receipt.steps.push(step.error);
      receipt.outcome = "failed";
      return ok(receipt);
    }
    outputs[node.id] = step.value.output;
    receipt.steps.push(step.value.receipt);
    cursor = step.value.nextId;
  }
  return ok(receipt);
}

async function simulateInTransaction(
  db: Db,
  actor: PermSetUser,
  input: PreparedDraftSimulationInput,
  signal: AbortSignal,
): Promise<Result<DraftSimulationReceipt, string>> {
  const authority = await currentDraftAuthority(db, actor, input.workflowId, signal);
  if (!authority.ok) return authority;
  const selected = await assertReferenceVisible(
    db,
    referenceActor(authority.value.actor),
    { kind: "deal", id: input.recordId },
    signal,
  );
  if (!selected.ok) return err(safeErrorId(selected.error.id));
  const definition = await currentDefinition(db, input.definition, signal);
  if (!definition.ok) return definition;
  const authoredJson = JSON.stringify(input.authoredDefinition);
  if (authoredJson.length > draftSimulationInputLimits.serializedUnits)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const clock = await stepClock(db, signal);
  if (!clock.ok) return clock;
  const receipt: DraftSimulationReceipt = {
    source: "draft",
    mode: "simulation",
    workflowId: authority.value.workflow.id,
    definitionDigest: createHash("sha256").update(authoredJson, "utf8").digest("hex"),
    testedAt: clock.value.toISOString(),
    outcome: "completed",
    steps: [],
  };
  return walkDraft(
    {
      db,
      actor,
      workflowId: input.workflowId,
      recordId: input.recordId,
      definition: definition.value,
      signal,
    },
    receipt,
  );
}

// Every successful or operational-failure receipt leaves through an intentional
// rollback. Canonical task previews additionally use their existing rolled-back
// savepoints, with reminders disabled. No published version or run row is created.
export async function simulateWorkflowDraft(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
): Promise<Result<DraftSimulationReceipt, string>> {
  signal.throwIfAborted();
  const input = prepareDraftSimulationInput(raw);
  if (!input.ok) return input;
  let result: Result<DraftSimulationReceipt, string> = err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  const containment = { rollbackRequested: false };
  try {
    await db.transaction(async (tx) => {
      result = await simulateInTransaction(tx, actor, input.value, signal);
      signal.throwIfAborted();
      containment.rollbackRequested = true;
      tx.rollback();
    });
  } catch (error) {
    signal.throwIfAborted();
    if (!containment.rollbackRequested || !(error instanceof TransactionRollbackError)) throw error;
  }
  signal.throwIfAborted();
  return result;
}
