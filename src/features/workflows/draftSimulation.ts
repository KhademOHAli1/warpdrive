import { createHash, randomUUID } from "node:crypto";
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
import { createWorkflowCalendarEvent } from "./workflowCalendarEvent";
import { createWorkflowEmailDraft } from "./workflowEmailDraft";
import { workflowIteratorMaxSteps } from "./workflowIteratorFrameContract";
import { workflowIteratorGraphReady } from "./workflowIteratorGraph";
import { workflowIteratorItemVisible, workflowIteratorMaySkipItem } from "./workflowIteratorRun";
import {
  advanceWorkflowIteratorRuntime,
  armWorkflowIteratorRuntime,
  resumeWorkflowIteratorRuntime,
  type WorkflowIteratorBodyReceipt,
  type WorkflowIteratorRuntimePlan,
} from "./workflowIteratorRuntime";
import type { WorkflowManualLaunchPayload } from "./workflowManualLaunchContract";
import { upsertWorkflowPerson } from "./workflowPersonUpsert";
import { createWorkflowRecord } from "./workflowRecordCreate";
import { mutateWorkflowRecord } from "./workflowRecordMutation";
import { pickWorkflowRecord } from "./workflowRecordPick";

type DraftNode = WorkflowNode & { type: DraftSimulationNodeType };
interface SimulationContext {
  db: Db;
  actor: PermSetUser;
  workflowId: string;
  launch: WorkflowManualLaunchPayload;
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
  if (!checked.ok || !workflowIteratorGraphReady(checked.value))
    return err(ERROR_IDS.WORKFLOW_INVALID);
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
  if (node.type === "record.upsert")
    return upsertWorkflowPerson(
      context.db,
      actor,
      node,
      outputs,
      context.definition,
      { workflowId: context.workflowId, mode: "draft-simulation" },
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
  if (node.type === "calendar.create")
    return createWorkflowCalendarEvent(
      context.db,
      actor,
      node,
      outputs,
      context.definition,
      "draft-simulation",
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
    context.launch,
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

async function simulateIteratorBody(
  context: SimulationContext,
  actor: PermSetUser,
  node: DraftNode,
  outputs: RunOutputs,
): Promise<Result<SuccessfulStep, DraftSimulationStep>> {
  let failed: DraftSimulationStep | undefined;
  try {
    return await context.db.transaction(async (db) => {
      const step = await simulateStep({ ...context, db }, actor, node, outputs);
      if (step.ok) return step;
      failed = step.error;
      return db.rollback();
    });
  } catch (error) {
    if (failed !== undefined && error instanceof TransactionRollbackError) return err(failed);
    throw error;
  }
}

interface DraftIteratorOccurrence {
  plan: WorkflowIteratorRuntimePlan | null;
  receipt: DraftSimulationStep;
  bodyReceipt?: WorkflowIteratorBodyReceipt;
}

async function simulateIteratorOccurrence(
  context: SimulationContext,
  runId: string,
  plan: Extract<WorkflowIteratorRuntimePlan, { status: "running" }>,
  receipts: readonly WorkflowIteratorBodyReceipt[],
): Promise<Result<DraftIteratorOccurrence, string>> {
  const { db, actor, workflowId, definition, signal } = context;
  const resumed = resumeWorkflowIteratorRuntime({ definition, runId, ...plan, receipts });
  if (!resumed.ok) return err(ERROR_IDS.WORKFLOW_INVALID);
  const node = definition.nodes.find((item) => item.id === plan.nextNodeId);
  if (node === undefined || !supportedNode(node)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const active = resumed.value;
  const authority = await currentDraftAuthority(db, actor, workflowId, signal);
  if (!authority.ok) return authority;
  const currentActor = authority.value.actor;
  if (!(await workflowIteratorItemVisible(db, currentActor, active, signal)))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const step = await simulateIteratorBody(context, currentActor, node, active.executionOutputs);
  const receipt = active.frame.execution;
  const { iterationIndex } = receipt;
  if (!step.ok) {
    const safe =
      step.error.errorId !== undefined && workflowIteratorMaySkipItem(step.error.errorId);
    const skipped = safe
      ? advanceWorkflowIteratorRuntime(active, { status: "itemFailed", receipt })
      : null;
    return ok({
      plan: skipped?.ok === true ? skipped.value : null,
      receipt: { ...step.error, iterationIndex },
    });
  }
  const next = advanceWorkflowIteratorRuntime(active, {
    status: "completed",
    receipt,
    nextNodeId: step.value.nextId ?? null,
  });
  return next.ok
    ? ok({
        plan: next.value,
        receipt: { ...step.value.receipt, iterationIndex },
        bodyReceipt: { ...receipt, output: step.value.output },
      })
    : err(ERROR_IDS.WORKFLOW_INVALID);
}

type DraftNodeProgress =
  | { status: "stopped" }
  | { status: "done"; outputs: RunOutputs; nextId: string | undefined };

async function walkDraftIterator(
  context: SimulationContext,
  iteratorNodeId: string,
  outputs: RunOutputs,
  receipt: DraftSimulationReceipt,
): Promise<Result<DraftNodeProgress, string>> {
  const runId = randomUUID();
  const armed = armWorkflowIteratorRuntime({
    definition: context.definition,
    runId,
    iteratorNodeId,
    outputs,
  });
  if (!armed.ok) return err(ERROR_IDS.WORKFLOW_INVALID);
  let plan = armed.value;
  const receipts: WorkflowIteratorBodyReceipt[] = [];
  while (plan.status === "running") {
    context.signal.throwIfAborted();
    if (receipt.steps.length >= workflowIteratorMaxSteps) return err(ERROR_IDS.WORKFLOW_INVALID);
    const step = await simulateIteratorOccurrence(context, runId, plan, receipts);
    if (!step.ok) return step;
    receipt.steps.push(step.value.receipt);
    const next = step.value.plan;
    if (next === null) {
      receipt.outcome = "failed";
      return ok({ status: "stopped" });
    }
    if (
      next.status === "running" &&
      next.iteratorFrame.itemIndex === plan.iteratorFrame.itemIndex &&
      step.value.bodyReceipt !== undefined
    ) {
      receipts.push(step.value.bodyReceipt);
    } else {
      receipts.length = 0;
    }
    plan = next;
  }
  const { processedCount, failedCount } = plan.summary;
  receipt.steps.push({
    nodeId: iteratorNodeId,
    nodeType: "iterator",
    status: "succeeded",
    ...(plan.nextNodeId === null ? {} : { port: "done" as const }),
    iteratorSummary: { processedCount, failedCount },
  });
  return ok({
    status: "done",
    outputs: { ...plan.outputs, [iteratorNodeId]: plan.summary },
    nextId: plan.nextNodeId ?? undefined,
  });
}

async function walkDraftStep(
  context: SimulationContext,
  node: DraftNode,
  outputs: RunOutputs,
  receipt: DraftSimulationReceipt,
): Promise<Result<DraftNodeProgress, string>> {
  const authority = await currentDraftAuthority(
    context.db,
    context.actor,
    context.workflowId,
    context.signal,
  );
  if (!authority.ok) return authority;
  if (node.type === "iterator") return walkDraftIterator(context, node.id, outputs, receipt);
  const step = await simulateStep(context, authority.value.actor, node, outputs);
  if (!step.ok) {
    receipt.steps.push(step.error);
    receipt.outcome = "failed";
    return ok({ status: "stopped" });
  }
  outputs[node.id] = step.value.output;
  receipt.steps.push(step.value.receipt);
  return ok({ status: "done", outputs, nextId: step.value.nextId });
}

async function walkDraft(
  context: SimulationContext,
  receipt: DraftSimulationReceipt,
): Promise<Result<DraftSimulationReceipt, string>> {
  const start = context.definition.nodes.find((node) => node.type === "trigger.manual");
  if (start === undefined) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const nodes = new Map(context.definition.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  let outputs: RunOutputs = {};
  let cursor: string | undefined = start.id;
  while (cursor !== undefined) {
    context.signal.throwIfAborted();
    if (visited.size >= 100 || visited.has(cursor)) return err(ERROR_IDS.WORKFLOW_INVALID);
    visited.add(cursor);
    const node = nodes.get(cursor);
    if (node === undefined || !supportedNode(node)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
    const step = await walkDraftStep(context, node, outputs, receipt);
    if (!step.ok) return step;
    if (step.value.status === "stopped") return ok(receipt);
    outputs = step.value.outputs;
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
  if ("recordId" in input.launch) {
    const selected = await assertReferenceVisible(
      db,
      referenceActor(authority.value.actor),
      { kind: "deal", id: input.launch.recordId },
      signal,
    );
    if (!selected.ok) return err(safeErrorId(selected.error.id));
  }
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
      launch: input.launch,
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
