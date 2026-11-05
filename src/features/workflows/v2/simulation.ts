import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { blockReferences, resolveBlockConfig } from "@/features/blocks/bindings";
import { findSharedBlock } from "@/features/blocks/catalog";
import type {
  BlockOutput,
  WorkflowV2Adapters,
  WorkflowV2Definition,
  WorkflowV2Node,
  WorkflowV2RunState,
  WorkflowV2Token,
} from "@/features/blocks/contracts";
import { blockOutputSchema, validateResolvedBlockConfig } from "@/features/blocks/schemas";
import { validateWorkflowV2 } from "@/features/blocks/validation";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "../access";
import { initialV2State } from "./admission";
import { executeFlowNode, type FlowOutcome, finishFlowStep } from "./flow";
import { V2_ERROR } from "./shared";

export interface WorkflowV2Simulation {
  mode: "test";
  steps: {
    nodeId: string;
    visitKey: string;
    state: "evaluated" | "skipped_effect" | "would_wait" | "failed";
    output: BlockOutput | null;
    errorId?: string;
  }[];
  status: "completed" | "failed" | "limited";
}
interface SimulationContext {
  db: Db;
  actor: PermSetUser;
  adapters: WorkflowV2Adapters;
  signal: AbortSignal;
}
type SimulationOutcome = {
  outcome: FlowOutcome;
  state: WorkflowV2Simulation["steps"][number]["state"];
};
async function readSimulationBlock(
  ctx: SimulationContext,
  node: WorkflowV2Node,
  config: BlockOutput,
) {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return ctx.adapters.native(tx, {
      actor: ctx.actor,
      node,
      resolvedConfig: config,
      effectKey: crypto.randomUUID(),
      signal: ctx.signal,
      nextPickIndex: () =>
        Promise.reject(new AppError(ERROR_IDS.WORKFLOW_INVALID, "Read cannot update pick state")),
    });
  });
}
async function simulateCode(
  ctx: SimulationContext,
  node: WorkflowV2Node,
  config: BlockOutput,
): Promise<Result<BlockOutput, string>> {
  const readiness = await ctx.adapters.readiness(
    ctx.db,
    ctx.actor,
    { ...node, config },
    ctx.signal,
  );
  if (readiness.state !== "ready") return err(V2_ERROR.notReady);
  const result = await ctx.adapters.external(
    {
      db: ctx.db,
      actor: ctx.actor,
      workflowId: "draft",
      runId: "draft",
      executionId: crypto.randomUUID(),
      effectKey: crypto.randomUUID(),
      mode: "test",
      signal: ctx.signal,
      nextPickIndex: () => Promise.resolve(0),
    },
    node,
    config,
  );
  return result.ok ? result : err(result.error.id);
}
function simulateFlow(
  node: WorkflowV2Node,
  config: BlockOutput,
): Result<SimulationOutcome, string> {
  const result = executeFlowNode(node, config, new Date());
  if (!result.ok) return result;
  return result.value.wait === undefined
    ? ok({ outcome: result.value, state: "evaluated" })
    : ok({
        outcome: { output: { simulated: true, wouldWait: result.value.wait.kind } },
        state: "would_wait",
      });
}
async function simulateBlock(
  ctx: SimulationContext,
  node: WorkflowV2Node,
  config: BlockOutput,
): Promise<Result<SimulationOutcome, string>> {
  if (!validateResolvedBlockConfig(node.type, config).success) return err(V2_ERROR.invalid);
  const effect = findSharedBlock(node.type)?.effect;
  if (effect === "pure" || effect === "wait") return simulateFlow(node, config);
  if (node.type === "CODE" || node.type === "LOGIC_FUNCTION" || effect === "read") {
    const result =
      effect === "read"
        ? await readSimulationBlock(ctx, node, config)
        : await simulateCode(ctx, node, config);
    return result.ok ? ok({ outcome: { output: result.value }, state: "evaluated" }) : result;
  }
  return ok({
    outcome: { output: { simulated: true, effectSkipped: true, blockType: node.type } },
    state: "skipped_effect",
  });
}
const simulationInput = z.strictObject({
  definition: z.unknown(),
  trigger: blockOutputSchema.optional(),
});
export async function testWorkflowV2Draft(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
): Promise<Result<WorkflowV2Simulation, string>> {
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null || !canWorkflow(current, "run")) return err(V2_ERROR.denied);
  const input = simulationInput.safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  const definition = validateWorkflowV2(input.data.definition);
  if (!definition.ok) return definition;
  return simulateDefinition(
    { db, actor: current, adapters, signal },
    definition.value,
    input.data.trigger ?? {},
  );
}
type SimulatedVisit =
  | { ok: true; value: SimulationOutcome }
  | { ok: false; status: "failed" | "limited"; step: WorkflowV2Simulation["steps"][number] };
async function simulateVisit(
  ctx: SimulationContext,
  node: WorkflowV2Node,
  token: WorkflowV2Token,
  state: WorkflowV2RunState,
  trigger: BlockOutput,
  simulated: Set<string>,
): Promise<SimulatedVisit> {
  const config = resolveBlockConfig(node.config, state.outputs, token.framePath, trigger);
  const result = config.ok ? await simulateBlock(ctx, node, config.value) : config;
  if (result.ok) return result;
  const dependency =
    !config.ok && blockReferences(node.config).some((ref) => simulated.has(ref.nodeId));
  return {
    ok: false,
    status: dependency ? "limited" : "failed",
    step: {
      nodeId: node.id,
      visitKey: token.visitKey,
      state: dependency ? "skipped_effect" : "failed",
      output: null,
      errorId: dependency ? "E_WORKFLOW_V2_TEST_DEPENDENCY" : result.error,
    },
  };
}
async function simulateDefinition(
  ctx: SimulationContext,
  definition: WorkflowV2Definition,
  trigger: BlockOutput,
): Promise<Result<WorkflowV2Simulation, string>> {
  const state = initialV2State(definition);
  const steps: WorkflowV2Simulation["steps"] = [];
  const simulated = new Set<string>();
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const finish = (status: WorkflowV2Simulation["status"]) =>
    ok({ mode: "test" as const, steps, status });
  let budget = 500_000;
  for (let index = 0; index < 200; index++) {
    ctx.signal.throwIfAborted();
    const token = state.queue.shift();
    if (token === undefined) return finish("completed");
    const node = nodes.get(token.nodeId);
    if (node === undefined) return err(V2_ERROR.invalid);
    const result = await simulateVisit(ctx, node, token, state, trigger, simulated);
    if (!result.ok) {
      steps.push(result.step);
      return finish(result.status);
    }
    const { outcome, state: stepState } = result.value;
    budget -= JSON.stringify(outcome.output).length;
    if (budget < 0) return finish("limited");
    if (stepState !== "evaluated") simulated.add(node.id);
    finishFlowStep(state, definition, token, node, outcome);
    steps.push({
      nodeId: node.id,
      visitKey: token.visitKey,
      state: stepState,
      output: outcome.output,
    });
  }
  return finish(state.queue.length > 0 ? "limited" : "completed");
}
