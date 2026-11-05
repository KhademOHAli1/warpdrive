import { and, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { notifications } from "@/db/schema/notifications";
import {
  workflowsV2,
  workflowV2Effects,
  workflowV2Executions,
  workflowV2Runs,
  workflowV2Versions,
  workflowV2Waits,
} from "@/db/schema/workflowV2";
import { resolveBlockConfig } from "@/features/blocks/bindings";
import { findSharedBlock } from "@/features/blocks/catalog";
import type {
  BlockOutput,
  WorkflowV2Adapters,
  WorkflowV2Definition,
  WorkflowV2Node,
  WorkflowV2Token,
} from "@/features/blocks/contracts";
import { blockOutputSchema, validateResolvedBlockConfig } from "@/features/blocks/schemas";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err } from "@/types/result";
import { canWorkflow } from "../access";
import { executeFlowNode, type FlowOutcome, finishFlowStep, recoverIterationFailure } from "./flow";
import { pureBlockReadiness } from "./readiness";
import { V2_ERROR } from "./shared";
import { boundSourcesVisible } from "./sourceAuthority";

type RunRow = typeof workflowV2Runs.$inferSelect;
type ExecutionRow = typeof workflowV2Executions.$inferSelect;
export interface AdvanceResult {
  status: RunRow["status"];
  runId: string;
  externalEffectId?: string;
}
class NativeFailure extends Error {
  constructor(readonly errorId: string) {
    super(errorId);
  }
}
function outputValid(value: unknown): value is BlockOutput {
  return blockOutputSchema.safeParse(value).success && JSON.stringify(value).length <= 200_000;
}
async function saveRun(
  db: Db,
  run: RunRow,
  status: RunRow["status"],
  errorId: string | null = null,
) {
  await db
    .update(workflowV2Runs)
    .set({ state: run.state, status, errorId, updatedAt: new Date() })
    .where(eq(workflowV2Runs.id, run.id));
  return { runId: run.id, status };
}
async function failStep(
  db: Db,
  run: RunRow,
  execution: ExecutionRow,
  token: WorkflowV2Token,
  errorId: string,
) {
  await db
    .update(workflowV2Executions)
    .set({ status: "failed", errorId, completedAt: new Date() })
    .where(eq(workflowV2Executions.id, execution.id));
  run.state.queue.shift();
  return recoverIterationFailure(run.state, token)
    ? saveRun(db, run, run.state.queue.length > 0 ? "running" : "succeeded")
    : saveRun(db, run, "failed", errorId);
}
export async function completeV2Step(
  db: Db,
  run: RunRow,
  execution: ExecutionRow,
  definition: WorkflowV2Definition,
  node: WorkflowV2Node,
  outcome: FlowOutcome,
  rollbackEffect = false,
): Promise<AdvanceResult> {
  const token = run.state.queue[0];
  if (token === undefined || token.visitKey !== execution.visitKey)
    return saveRun(db, run, "failed", "E_WORKFLOW_V2_CURSOR");
  if (!outputValid(outcome.output))
    return failStep(db, run, execution, token, "E_WORKFLOW_V2_OUTPUT_LIMIT");
  const next = { ...run, state: structuredClone(run.state) };
  next.state.queue.shift();
  next.state.stepCount++;
  finishFlowStep(next.state, definition, token, node, outcome);
  if (JSON.stringify(next.state).length > 2_000_000) {
    if (rollbackEffect) throw new NativeFailure("E_WORKFLOW_V2_OUTPUT_LIMIT");
    return failStep(db, run, execution, token, "E_WORKFLOW_V2_OUTPUT_LIMIT");
  }
  await db
    .update(workflowV2Executions)
    .set({ status: "completed", output: outcome.output, completedAt: new Date() })
    .where(eq(workflowV2Executions.id, execution.id));
  return saveRun(db, next, next.state.queue.length > 0 ? "running" : "succeeded");
}
function pickCounter(db: Db, workflowId: string) {
  return async (nodeId: string, count: number) => {
    const [row] = await db
      .select({ runtimeState: workflowsV2.runtimeState })
      .from(workflowsV2)
      .where(eq(workflowsV2.id, workflowId))
      .for("update");
    if (row === undefined || count < 1) throw new NativeFailure("E_WORKFLOW_V2_PICK");
    const current = row.runtimeState[nodeId] ?? 0;
    const index = Number.isSafeInteger(current) && current >= 0 ? current % count : 0;
    await db
      .update(workflowsV2)
      .set({ runtimeState: { ...row.runtimeState, [nodeId]: (index + 1) % count } })
      .where(eq(workflowsV2.id, workflowId));
    return index;
  };
}
async function insertWait(
  db: Db,
  run: RunRow,
  execution: ExecutionRow,
  outcome: FlowOutcome,
): Promise<AdvanceResult> {
  const wait = outcome.wait;
  if (wait === undefined) throw new AppError(ERROR_IDS.WORKFLOW_INVALID, "Missing wait outcome");
  const [row] = await db
    .insert(workflowV2Waits)
    .values({
      runId: run.id,
      executionId: execution.id,
      kind: wait.kind,
      config: wait.config,
      responderId: wait.responderId ?? run.actorId,
      wakeAt: wait.wakeAt ?? null,
      expiresAt: wait.expiresAt ?? null,
    })
    .returning({ id: workflowV2Waits.id });
  if (row === undefined) throw new NativeFailure(V2_ERROR.write);
  if (wait.kind === "chat")
    await linkApproval(db, row.id, wait.responderId, outcome.output.notificationId);
  await db
    .update(workflowV2Executions)
    .set({ status: "waiting" })
    .where(eq(workflowV2Executions.id, execution.id));
  return saveRun(db, run, "waiting");
}
async function linkApproval(
  db: Db,
  waitId: string,
  responderId: string | undefined,
  notificationId: BlockOutput[string] | undefined,
) {
  if (responderId === undefined || typeof notificationId !== "string")
    throw new NativeFailure(V2_ERROR.write);
  const [notification] = await db
    .update(notifications)
    .set({
      payload: sql`${notifications.payload} || jsonb_build_object('approvalWaitId', ${waitId}::text)`,
    })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, responderId),
        eq(notifications.type, "workflow_message"),
      ),
    )
    .returning({ id: notifications.id });
  if (notification === undefined) throw new NativeFailure(V2_ERROR.write);
}
interface StepContext {
  db: Db;
  run: RunRow;
  execution: ExecutionRow;
  token: WorkflowV2Token;
  node: WorkflowV2Node;
  definition: WorkflowV2Definition;
  actor: PermSetUser;
  adapters: WorkflowV2Adapters;
  signal: AbortSignal;
}
function fail(ctx: StepContext, errorId: string) {
  return failStep(ctx.db, ctx.run, ctx.execution, ctx.token, errorId);
}
function complete(ctx: StepContext, outcome: FlowOutcome, rollbackEffect = false) {
  return completeV2Step(
    ctx.db,
    ctx.run,
    ctx.execution,
    ctx.definition,
    ctx.node,
    outcome,
    rollbackEffect,
  );
}
async function runFlowBlock(ctx: StepContext, config: BlockOutput) {
  const result = executeFlowNode(ctx.node, config, new Date());
  if (!result.ok) return fail(ctx, result.error);
  if (result.value.wait === undefined) return complete(ctx, result.value);
  if (ctx.run.mode === "test")
    return complete(ctx, { output: { simulated: true, wouldWait: result.value.wait.kind } });
  return insertWait(ctx.db, ctx.run, ctx.execution, result.value);
}
async function prepareExternal(ctx: StepContext, config: BlockOutput): Promise<AdvanceResult> {
  const [intent] = await ctx.db
    .insert(workflowV2Effects)
    .values({ runId: ctx.run.id, executionId: ctx.execution.id, request: config })
    .returning({ id: workflowV2Effects.id });
  if (intent === undefined) return fail(ctx, V2_ERROR.write);
  await saveRun(ctx.db, ctx.run, "running");
  return { runId: ctx.run.id, status: "running", externalEffectId: intent.id };
}
async function runNativeBlock(ctx: StepContext, config: BlockOutput): Promise<AdvanceResult> {
  try {
    return await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('warpdrive.workflow_v2_run_id', ${ctx.run.id}, true)`);
      const result = await ctx.adapters.native(tx, {
        actor: ctx.actor,
        node: ctx.node,
        resolvedConfig: config,
        effectKey: ctx.execution.id,
        signal: ctx.signal,
        nextPickIndex: pickCounter(tx, ctx.run.workflowId),
      });
      if (!result.ok) throw new NativeFailure(result.error);
      if (!outputValid(result.value)) throw new NativeFailure("E_WORKFLOW_V2_OUTPUT_LIMIT");
      const step = { ...ctx, db: tx };
      if (ctx.node.type === "SEND_CHAT_MESSAGE" && config.requireApproval === true) {
        const responderId = typeof config.recipientId === "string" ? config.recipientId : undefined;
        return insertWait(tx, ctx.run, ctx.execution, {
          output: result.value,
          wait: { kind: "chat", config, responderId },
        });
      }
      return complete(step, { output: result.value }, true);
    });
  } catch (error) {
    if (error instanceof NativeFailure) return fail(ctx, error.errorId);
    throw error;
  }
}
function visibleSources(ctx: StepContext) {
  return boundSourcesVisible(
    ctx.db,
    ctx.actor,
    ctx.definition,
    ctx.node,
    ctx.run.state,
    ctx.token.framePath,
    ctx.run.trigger,
    ctx.signal,
  );
}
async function runConfiguredBlock(ctx: StepContext): Promise<AdvanceResult> {
  const resolved = resolveBlockConfig(
    ctx.node.config,
    ctx.run.state.outputs,
    ctx.token.framePath,
    ctx.run.trigger,
  );
  if (!resolved.ok) return fail(ctx, resolved.error);
  const config = resolved.value;
  if (!validateResolvedBlockConfig(ctx.node.type, config).success)
    return fail(ctx, V2_ERROR.invalid);
  if (JSON.stringify(config).length > 200_000) return fail(ctx, V2_ERROR.limit);
  const effect = findSharedBlock(ctx.node.type)?.effect;
  const node = { ...ctx.node, config };
  const flow = effect === "pure" || effect === "wait";
  const readiness = flow
    ? pureBlockReadiness(node)
    : await ctx.adapters.readiness(ctx.db, ctx.actor, node, ctx.signal);
  if (readiness.state !== "ready") return fail(ctx, V2_ERROR.notReady);
  if (flow) return runFlowBlock(ctx, config);
  if (
    ctx.run.mode === "test" &&
    effect !== "read" &&
    ctx.node.type !== "CODE" &&
    ctx.node.type !== "LOGIC_FUNCTION"
  )
    return complete(ctx, {
      output: { simulated: true, effectSkipped: true, blockType: ctx.node.type },
    });
  if (effect !== "read" && !(await visibleSources(ctx)))
    return fail(ctx, "E_WORKFLOW_V2_SOURCE_REVOKED");
  return effect === "external" ? prepareExternal(ctx, config) : runNativeBlock(ctx, config);
}
async function currentRunActor(db: Db, run: RunRow, signal: AbortSignal) {
  const [workflow] = await db.select().from(workflowsV2).where(eq(workflowsV2.id, run.workflowId));
  const actor = await hydrateActor(db, run.actorId, signal);
  if (
    workflow === undefined ||
    actor === null ||
    !canWorkflow(actor, "run", workflow.ownerId) ||
    !workflow.active ||
    workflow.archivedAt !== null
  )
    return null;
  return actor;
}
async function existingExecution(
  db: Db,
  run: RunRow,
  token: WorkflowV2Token,
): Promise<AdvanceResult | null> {
  const [execution] = await db
    .select()
    .from(workflowV2Executions)
    .where(
      and(
        eq(workflowV2Executions.runId, run.id),
        eq(workflowV2Executions.visitKey, token.visitKey),
      ),
    );
  if (execution === undefined) return null;
  const [effect] = await db
    .select()
    .from(workflowV2Effects)
    .where(eq(workflowV2Effects.executionId, execution.id));
  return effect === undefined
    ? saveRun(db, run, "failed", "E_WORKFLOW_V2_CURSOR")
    : { runId: run.id, status: run.status, externalEffectId: effect.id };
}
async function prepareStep(
  db: Db,
  runId: string,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
): Promise<AdvanceResult> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowV2Runs)
      .where(eq(workflowV2Runs.id, runId))
      .for("update");
    if (run === undefined) return { runId, status: "failed" };
    if (!["queued", "running"].includes(run.status)) return { runId, status: run.status };
    const actor = await currentRunActor(tx, run, signal);
    if (actor === null) return saveRun(tx, run, "cancelled", V2_ERROR.denied);
    if (run.state.stepCount >= 20_000 || JSON.stringify(run.state).length > 1_600_000)
      return saveRun(tx, run, "failed", V2_ERROR.limit);
    const [version] = await tx
      .select()
      .from(workflowV2Versions)
      .where(
        and(
          eq(workflowV2Versions.id, run.versionId),
          eq(workflowV2Versions.workflowId, run.workflowId),
        ),
      );
    if (version === undefined) return saveRun(tx, run, "failed", V2_ERROR.missing);
    const token = run.state.queue[0];
    if (token === undefined) return saveRun(tx, run, "succeeded");
    const node = version.definition.nodes.find((row) => row.id === token.nodeId);
    if (node === undefined) return saveRun(tx, run, "failed", V2_ERROR.invalid);
    const existing = await existingExecution(tx, run, token);
    if (existing !== null) return existing;
    const [execution] = await tx
      .insert(workflowV2Executions)
      .values({
        runId: run.id,
        nodeId: node.id,
        visitKey: token.visitKey,
        framePath: token.framePath,
        status: "running",
      })
      .returning();
    if (execution === undefined) return saveRun(tx, run, "failed", V2_ERROR.write);
    return runConfiguredBlock({
      db: tx,
      run,
      execution,
      token,
      node,
      definition: version.definition,
      actor,
      adapters,
      signal,
    });
  });
}
export async function advanceWorkflowV2Run(
  db: Db,
  runId: string,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
): Promise<AdvanceResult> {
  signal.throwIfAborted();
  const result = await prepareStep(db, runId, adapters, signal);
  return result.externalEffectId === undefined
    ? result
    : executeWorkflowV2Effect(db, result.externalEffectId, adapters, signal);
}
export async function executeWorkflowV2Effect(
  db: Db,
  id: string,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
): Promise<AdvanceResult> {
  const claimed = await db.transaction(async (tx) => {
    const [lookup] = await tx.select().from(workflowV2Effects).where(eq(workflowV2Effects.id, id));
    if (lookup === undefined) return null;
    const [run] = await tx
      .select()
      .from(workflowV2Runs)
      .where(eq(workflowV2Runs.id, lookup.runId))
      .for("update");
    if (run === undefined) return null;
    const [effect] = await tx
      .select()
      .from(workflowV2Effects)
      .where(eq(workflowV2Effects.id, id))
      .for("update");
    if (effect === undefined) return null;
    const [execution] = await tx
      .select()
      .from(workflowV2Executions)
      .where(eq(workflowV2Executions.id, effect.executionId));
    const [version] = await tx
      .select()
      .from(workflowV2Versions)
      .where(eq(workflowV2Versions.id, run.versionId));
    const [workflow] = await tx
      .select()
      .from(workflowsV2)
      .where(eq(workflowsV2.id, run.workflowId));
    if (execution === undefined || version === undefined || workflow === undefined) return null;
    if (
      effect.status === "claimed" &&
      effect.leaseUntil !== null &&
      effect.leaseUntil <= new Date()
    ) {
      await tx
        .update(workflowV2Effects)
        .set({
          status: "unknown",
          errorId: "E_WORKFLOW_V2_EXTERNAL_UNKNOWN",
          updatedAt: new Date(),
        })
        .where(eq(workflowV2Effects.id, id));
      await saveRun(tx, run, "failed", "E_WORKFLOW_V2_EXTERNAL_UNKNOWN");
      return null;
    }
    if (effect.status !== "prepared" || !["queued", "running"].includes(run.status)) return null;
    const actor = await hydrateActor(tx, run.actorId, signal);
    const node = version.definition.nodes.find((row) => row.id === execution.nodeId);
    if (
      actor === null ||
      node === undefined ||
      !workflow.active ||
      workflow.archivedAt !== null ||
      !canWorkflow(actor, "run", workflow.ownerId)
    ) {
      await saveRun(tx, run, "cancelled", V2_ERROR.denied);
      return null;
    }
    if (
      !(await boundSourcesVisible(
        tx,
        actor,
        version.definition,
        node,
        run.state,
        execution.framePath,
        run.trigger,
        signal,
      ))
    ) {
      await tx
        .update(workflowV2Effects)
        .set({ status: "failed", errorId: "E_WORKFLOW_V2_SOURCE_REVOKED", updatedAt: new Date() })
        .where(eq(workflowV2Effects.id, id));
      await tx
        .update(workflowV2Executions)
        .set({ status: "failed", errorId: "E_WORKFLOW_V2_SOURCE_REVOKED", completedAt: new Date() })
        .where(eq(workflowV2Executions.id, execution.id));
      await saveRun(tx, run, "failed", "E_WORKFLOW_V2_SOURCE_REVOKED");
      return null;
    }
    const readiness = await adapters.readiness(
      tx,
      actor,
      { ...node, config: effect.request },
      signal,
    );
    if (readiness.state !== "ready") {
      await saveRun(tx, run, "failed", V2_ERROR.notReady);
      return null;
    }
    await tx
      .update(workflowV2Effects)
      .set({ status: "claimed", leaseUntil: new Date(Date.now() + 60_000), updatedAt: new Date() })
      .where(eq(workflowV2Effects.id, id));
    return { effect, run, execution, version, node, actor };
  });
  if (claimed === null) {
    const [effect] = await db.select().from(workflowV2Effects).where(eq(workflowV2Effects.id, id));
    const [run] =
      effect === undefined
        ? []
        : await db.select().from(workflowV2Runs).where(eq(workflowV2Runs.id, effect.runId));
    return { runId: run?.id ?? "", status: run?.status ?? "failed" };
  }
  let result: Awaited<ReturnType<WorkflowV2Adapters["external"]>>;
  try {
    result = await adapters.external(
      {
        db,
        actor: claimed.actor,
        workflowId: claimed.run.workflowId,
        runId: claimed.run.id,
        executionId: claimed.execution.id,
        effectKey: claimed.effect.effectKey,
        mode: claimed.run.mode,
        signal,
        nextPickIndex: () =>
          Promise.reject(
            new AppError(ERROR_IDS.WORKFLOW_INVALID, "External effect cannot mutate pick cursor"),
          ),
      },
      claimed.node,
      claimed.effect.request,
    );
  } catch {
    result = err({ id: "E_WORKFLOW_V2_EXTERNAL_UNKNOWN", outcome: "unknown" });
  }
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowV2Runs)
      .where(eq(workflowV2Runs.id, claimed.run.id))
      .for("update");
    const [effect] = await tx
      .select()
      .from(workflowV2Effects)
      .where(eq(workflowV2Effects.id, id))
      .for("update");
    if (run === undefined || effect === undefined)
      return { runId: claimed.run.id, status: "failed" };
    if (effect.status !== "claimed") return { runId: run.id, status: run.status };
    if (result.ok && !outputValid(result.value)) result = err({ id: "E_WORKFLOW_V2_OUTPUT_LIMIT" });
    await tx
      .update(workflowV2Effects)
      .set({
        status: result.ok ? "applied" : result.error.outcome === "unknown" ? "unknown" : "failed",
        output: result.ok ? result.value : null,
        errorId: result.ok ? null : result.error.id,
        updatedAt: new Date(),
      })
      .where(eq(workflowV2Effects.id, id));
    if (!["running", "queued"].includes(run.status)) return { runId: run.id, status: run.status };
    if (!result.ok) {
      const token = run.state.queue[0];
      return token === undefined
        ? saveRun(tx, run, "failed", result.error.id)
        : failStep(tx, run, claimed.execution, token, result.error.id);
    }
    return completeV2Step(tx, run, claimed.execution, claimed.version.definition, claimed.node, {
      output: result.value,
    });
  });
}
