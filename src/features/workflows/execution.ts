import { eq } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, workflows, workflowVersions } from "@/db/schema";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { executeRunNode } from "./runActions";

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
    if (run.status !== "queued" && run.status !== "running") return ok(run.status);
    const actor = await hydrateActor(tx, run.actorId, signal);
    const [workflow] = await tx.select().from(workflows).where(eq(workflows.id, run.workflowId));
    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, run.versionId));
    const node = version?.definition.nodes.find((item) => item.id === run.nextNodeId);
    if (
      actor === null ||
      workflow === undefined ||
      !canWorkflow(actor, "run", workflow.ownerId) ||
      workflow.archivedAt !== null ||
      node === undefined
    ) {
      await tx
        .update(workflowRuns)
        .set({ status: "failed", errorId: ERROR_IDS.WORKFLOW_DENIED, updatedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
      return ok("failed" as const);
    }
    const result = await executeRunNode(
      tx,
      actor,
      node,
      run.outputs,
      run.trigger,
      run.mode === "simulation",
      signal,
    );
    if (!result.ok) {
      await tx
        .update(workflowRuns)
        .set({ status: "failed", errorId: result.error, updatedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
      return ok("failed" as const);
    }
    await tx.insert(workflowSteps).values({
      runId,
      nodeId: node.id,
      simulated: run.mode === "simulation",
      output: result.value,
    });
    const port =
      node.type === "condition" ? (result.value.result === true ? "true" : "false") : "next";
    const next = version?.definition.edges.find(
      (edge) => edge.from === node.id && edge.port === port,
    );
    const status = next === undefined ? ("succeeded" as const) : ("running" as const);
    await tx
      .update(workflowRuns)
      .set({
        status,
        nextNodeId: next?.to ?? null,
        outputs: { ...run.outputs, [node.id]: result.value },
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, runId));
    signal.throwIfAborted();
    return ok(status);
  });
}
