import { and, eq, sql, TransactionRollbackError } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { selectRunBranch } from "./runBranchSelection";
import { advanceRunStep } from "./runStep";
import type { StepOutput } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import {
  type ActiveWorkflowIterator,
  advanceWorkflowIteratorRuntime,
  armWorkflowIteratorRuntime,
  resumeWorkflowIteratorRuntime,
  type WorkflowIteratorRuntimePlan,
} from "./workflowIteratorRuntime";
import { workflowIteratorCursor } from "./workflowIteratorRuntimeContract";
import { readWorkflowManualLaunch } from "./workflowManualLaunchContract";
import { visibleWorkflowRecordSource } from "./workflowRecordQuery";

interface LockedRun {
  db: Db;
  actor: PermSetUser;
  node: WorkflowNode;
  run: typeof workflowRuns.$inferSelect;
  definition: WorkflowDefinition;
  now: Date;
  signal: AbortSignal;
}

type IteratorProgress =
  | { status: "running" | "succeeded" }
  | { status: "waiting"; armedDeadline?: Date };

type BodyProgress =
  | Extract<IteratorProgress, { status: "waiting" }>
  | { status: "completed"; output: StepOutput; plan: WorkflowIteratorRuntimePlan };

const localItemFailures = new Set<string>([
  ERROR_IDS.WORKFLOW_BINDING_MISSING,
  ERROR_IDS.DEAL_NOT_FOUND,
  ERROR_IDS.DEAL_ARCHIVED_NO_ACTIVITY,
  ERROR_IDS.LEAD_NOT_FOUND,
  ERROR_IDS.CONTACT_NOT_FOUND,
  ERROR_IDS.ACTIVITY_NOT_FOUND,
  ERROR_IDS.ACTIVITY_END_BEFORE_START,
]);

export function workflowIteratorMaySkipItem(errorId: string): boolean {
  return localItemFailures.has(errorId);
}

export async function workflowIteratorItemVisible(
  db: Db,
  actor: PermSetUser,
  active: ActiveWorkflowIterator,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (active.currentRecord === null) return true;
  const { entity, id } = active.currentRecord;
  const source = visibleWorkflowRecordSource(entity, actor);
  const found = await db.execute(sql`SELECT 1 FROM ${source.from}
    WHERE ${source.visible} AND ${source.field("id")} = ${id}::uuid LIMIT 1`);
  signal.throwIfAborted();
  return found.rows.length === 1;
}

function runtimeInput({ run, definition }: LockedRun) {
  return { runId: run.id, definition, outputs: run.outputs };
}

async function readOccurrence(context: LockedRun): Promise<Result<ActiveWorkflowIterator, string>> {
  const { db, run, signal } = context;
  const cursor = workflowIteratorCursor.safeParse(run.iteratorFrame);
  if (!cursor.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const receipts = await db
    .select()
    .from(workflowSteps)
    .where(
      and(eq(workflowSteps.runId, run.id), eq(workflowSteps.iterationIndex, cursor.data.itemIndex)),
    );
  signal.throwIfAborted();
  if (
    receipts.some(
      (receipt) =>
        receipt.outcome !== "succeeded" || receipt.simulated !== (run.mode === "simulation"),
    )
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const active = resumeWorkflowIteratorRuntime({
    ...runtimeInput(context),
    nextNodeId: run.nextNodeId,
    iteratorFrame: cursor.data,
    receipts,
  });
  return active.ok ? active : err(ERROR_IDS.WORKFLOW_INVALID);
}

async function writePlan(
  context: LockedRun,
  iteratorNodeId: string,
  plan: WorkflowIteratorRuntimePlan,
): Promise<Result<IteratorProgress, string>> {
  const { db, run, now, signal } = context;
  const outputs =
    plan.status === "done" ? { ...plan.outputs, [iteratorNodeId]: plan.summary } : plan.outputs;
  if (plan.status === "done") {
    await db.insert(workflowSteps).values({
      runId: run.id,
      nodeId: iteratorNodeId,
      simulated: run.mode === "simulation",
      output: plan.summary,
      completedAt: now,
    });
  }
  const status = plan.nextNodeId === null ? "succeeded" : "running";
  await db
    .update(workflowRuns)
    .set({
      status,
      resumeAt: null,
      nextNodeId: plan.nextNodeId,
      iteratorFrame: plan.iteratorFrame,
      outputs,
      updatedAt: now,
    })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok({ status });
}

async function applyBody(
  context: LockedRun,
  active: ActiveWorkflowIterator,
): Promise<Result<BodyProgress, string>> {
  const { db, actor, node, run, now, definition, signal } = context;
  let rejected: string | undefined;
  try {
    return await db.transaction(async (tx) => {
      const step = await advanceRunStep(
        tx,
        actor,
        node,
        run,
        now,
        definition,
        signal,
        active.executionOutputs,
      );
      if (!step.ok) {
        rejected = step.error;
        return tx.rollback();
      }
      if (step.value.status === "waiting") return ok(step.value);
      const output = step.value.output;
      const branch = selectRunBranch(definition, node, output);
      if (!branch.ok) {
        rejected = branch.error;
        return tx.rollback();
      }
      const plan = advanceWorkflowIteratorRuntime(active, {
        status: "completed",
        receipt: active.frame.execution,
        nextNodeId: branch.value?.to ?? null,
      });
      if (!plan.ok) {
        rejected = ERROR_IDS.WORKFLOW_INVALID;
        return tx.rollback();
      }
      signal.throwIfAborted();
      return ok({ status: "completed" as const, output, plan: plan.value });
    });
  } catch (error) {
    if (rejected !== undefined && error instanceof TransactionRollbackError) return err(rejected);
    throw error;
  }
}

async function failedOccurrence(
  context: LockedRun,
  active: ActiveWorkflowIterator,
  errorId: string,
) {
  const { db, run, node, now } = context;
  const execution = active.frame.execution;
  const safeError = Object.values(ERROR_IDS).some((known) => known === errorId)
    ? errorId
    : ERROR_IDS.WORKFLOW_WRITE_FAILED;
  await db.insert(workflowSteps).values({
    runId: run.id,
    nodeId: node.id,
    iterationIndex: execution.iterationIndex,
    simulated: run.mode === "simulation",
    outcome: "failed",
    output: {},
    errorId: safeError,
    completedAt: now,
  });
  if (!workflowIteratorMaySkipItem(safeError)) return err(safeError);
  const next = advanceWorkflowIteratorRuntime(active, { status: "itemFailed", receipt: execution });
  return next.ok ? writePlan(context, execution.iteratorNodeId, next.value) : err(safeError);
}

// The caller owns the run row lock. Body effects, occurrence receipts and the
// next frame commit together; a rejected body step rolls back its savepoint.
export async function advanceWorkflowIteratorRun(
  context: LockedRun,
): Promise<Result<IteratorProgress, string>> {
  const { db, actor, node, run, now, signal } = context;
  if (run.iteratorFrame === null) {
    if (
      node.type !== "iterator" ||
      run.status === "waiting" ||
      readWorkflowManualLaunch(context.definition, run.trigger) === null
    )
      return err(ERROR_IDS.WORKFLOW_INVALID);
    const armed = armWorkflowIteratorRuntime({ ...runtimeInput(context), iteratorNodeId: node.id });
    return armed.ok ? writePlan(context, node.id, armed.value) : err(ERROR_IDS.WORKFLOW_INVALID);
  }
  const active = await readOccurrence(context);
  if (!active.ok) return active;
  if (!(await workflowIteratorItemVisible(db, actor, active.value, signal)))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const step = await applyBody(context, active.value);
  if (!step.ok) return failedOccurrence(context, active.value, step.error);
  if (step.value.status === "waiting") return ok(step.value);
  const execution = active.value.frame.execution;
  await db.insert(workflowSteps).values({
    runId: run.id,
    nodeId: node.id,
    iterationIndex: execution.iterationIndex,
    simulated: run.mode === "simulation",
    output: step.value.output,
    completedAt: now,
  });
  return writePlan(context, execution.iteratorNodeId, step.value.plan);
}
