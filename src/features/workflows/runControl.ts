import { eq } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";

export async function cancelWorkflowRun(
  db: Db,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
) {
  if (!z.string().uuid().safeParse(id).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(workflowRuns).where(eq(workflowRuns.id, id)).for("update");
    const currentActor = await hydrateActor(tx, actor.id, signal);
    if (run === undefined || currentActor === null) return err(ERROR_IDS.WORKFLOW_DENIED);
    const [workflow] = await tx.select().from(workflows).where(eq(workflows.id, run.workflowId));
    if (workflow === undefined || !canWorkflow(currentActor, "cancel", workflow.ownerId))
      return err(ERROR_IDS.WORKFLOW_DENIED);
    if (run.status !== "queued" && run.status !== "running") return ok(run.status);
    await tx
      .update(workflowRuns)
      .set({
        status: "cancelled",
        cancelledBy: actor.id,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, id));
    signal.throwIfAborted();
    return ok("cancelled" as const);
  });
}
