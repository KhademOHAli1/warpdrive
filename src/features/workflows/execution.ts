import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  workflowRunFailures,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { selectRunBranch } from "./runBranchSelection";
import { advanceRunStep } from "./runStep";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";
import { workflowIteratorAllowsUnframedNode } from "./workflowIteratorGraph";
import { advanceWorkflowIteratorRun } from "./workflowIteratorRun";

export { admitManualRun } from "./runAdmission";

async function advanceLockedStep(
  db: Db,
  actor: PermSetUser,
  run: typeof workflowRuns.$inferSelect,
  node: WorkflowNode,
  definition: WorkflowDefinition,
  now: Date,
  signal: AbortSignal,
) {
  if (run.iteratorFrame !== null || node.type === "iterator")
    return advanceWorkflowIteratorRun({ db, actor, node, run, now, definition, signal });
  if (!workflowIteratorAllowsUnframedNode(definition, node.id))
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const result = await advanceRunStep(db, actor, node, run, now, definition, signal);
  if (!result.ok) return result;
  if (result.value.status === "waiting") return ok(result.value);
  const output = result.value.output;
  const selected = selectRunBranch(definition, node, output);
  if (!selected.ok) return selected;
  const next = selected.value;
  await db.insert(workflowSteps).values({
    runId: run.id,
    nodeId: node.id,
    simulated: run.mode === "simulation",
    output,
    completedAt: now,
  });
  const status = next === undefined ? ("succeeded" as const) : ("running" as const);
  await db
    .update(workflowRuns)
    .set({
      status,
      resumeAt: null,
      nextNodeId: next?.to ?? null,
      outputs: { ...run.outputs, [node.id]: output },
      updatedAt: now,
    })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok({ status });
}

// Database-only effects and progress share this transaction. A crash rolls both back;
// competing workers serialize on the run row and re-read the persisted cursor.
export async function advanceWorkflowRun(
  db: Db,
  runId: string,
  signal: AbortSignal,
  onWaitArmed?: (deadline: Date, databaseNow: Date) => Promise<void>,
) {
  if (!z.string().uuid().safeParse(runId).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  let wait: { deadline: Date | undefined; databaseNow: Date } | undefined;
  const progress = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .for("update");
    signal.throwIfAborted();
    if (run === undefined) return err(ERROR_IDS.WORKFLOW_DENIED);
    if (run.status !== "queued" && run.status !== "running" && run.status !== "waiting")
      return ok(run.status);
    // Read the clock after acquiring the row lock, including time spent waiting for it.
    const clock = await tx.execute<{ milliseconds: number }>(
      sql`SELECT extract(epoch from clock_timestamp())::double precision * 1000 AS milliseconds`,
    );
    const now = new Date(clock.rows[0]?.milliseconds ?? Number.NaN);
    if (!Number.isFinite(now.getTime())) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
    signal.throwIfAborted();
    const actor = await hydrateActor(tx, run.actorId, signal);
    const [workflow] = await tx.select().from(workflows).where(eq(workflows.id, run.workflowId));
    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, run.versionId));
    if (
      actor === null ||
      workflow === undefined ||
      !canWorkflow(actor, "run", workflow.ownerId) ||
      workflow.archivedAt !== null ||
      version === undefined
    )
      return failRun(tx, run, ERROR_IDS.WORKFLOW_DENIED, now, signal);
    const parsed = definitionSchema.safeParse(version.definition);
    if (!parsed.success) return failRun(tx, run, ERROR_IDS.WORKFLOW_INVALID, now, signal);
    const definition = parsed.data;
    const node = definition.nodes.find((item) => item.id === run.nextNodeId);
    if (node === undefined) return failRun(tx, run, ERROR_IDS.WORKFLOW_DENIED, now, signal);
    const result = await advanceLockedStep(tx, actor, run, node, definition, now, signal);
    if (!result.ok) return failRun(tx, run, result.error, now, signal);
    if (result.value.status === "waiting")
      wait = { deadline: result.value.armedDeadline, databaseNow: now };
    return ok(result.value.status);
  });
  if (wait?.deadline !== undefined) await onWaitArmed?.(wait.deadline, wait.databaseNow);
  return progress;
}

async function failRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  errorId: string,
  now: Date,
  signal: AbortSignal,
) {
  await db.insert(workflowRunFailures).values({
    runId: run.id,
    nodeId: run.nextNodeId,
    errorId,
    failedAt: now,
    originalResumeAt: run.resumeAt,
  });
  await db
    .update(workflowRuns)
    .set({ status: "failed", resumeAt: null, iteratorFrame: null, errorId, updatedAt: now })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok("failed" as const);
}
