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
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { advanceRunStep } from "./runStep";
import { definitionSchema } from "./schemas";

export { admitManualRun } from "./runAdmission";

// Database-only effects and progress share this transaction. A crash rolls both back;
// competing workers serialize on the run row and re-read the persisted cursor.
export async function advanceWorkflowRun(db: Db, runId: string, signal: AbortSignal) {
  if (!z.string().uuid().safeParse(runId).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return db.transaction(async (tx) => {
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
    const result = await advanceRunStep(tx, actor, node, run, now, definition, signal);
    if (!result.ok) return failRun(tx, run, result.error, now, signal);
    if (result.value.status === "waiting") return ok("waiting" as const);
    const output = result.value.output;
    await tx.insert(workflowSteps).values({
      runId,
      nodeId: node.id,
      simulated: run.mode === "simulation",
      output,
      completedAt: now,
    });
    const port = node.type === "condition" ? (output.result === true ? "true" : "false") : "next";
    const next = definition.edges.find((edge) => edge.from === node.id && edge.port === port);
    const status = next === undefined ? ("succeeded" as const) : ("running" as const);
    await tx
      .update(workflowRuns)
      .set({
        status,
        resumeAt: null,
        nextNodeId: next?.to ?? null,
        outputs: { ...run.outputs, [node.id]: output },
        updatedAt: now,
      })
      .where(eq(workflowRuns.id, runId));
    signal.throwIfAborted();
    return ok(status);
  });
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
    .set({ status: "failed", resumeAt: null, errorId, updatedAt: now })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok("failed" as const);
}
