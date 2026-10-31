import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { executableDefinition } from "./readiness";

const inputSchema = z.strictObject({
  workflowId: z.string().uuid(),
  requestKey: z.string().uuid(),
  recordId: z.string().uuid(),
  mode: z.enum(["simulation", "live"]).default("simulation"),
});

export async function admitManualRun(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = inputSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return db.transaction(async (tx) => {
    const currentActor = await hydrateActor(tx, actor.id, signal);
    if (currentActor === null) return err(ERROR_IDS.WORKFLOW_DENIED);
    const [workflow] = await tx
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, input.data.workflowId), isNull(workflows.archivedAt)))
      .for("update");
    if (
      workflow === undefined ||
      !workflow.active ||
      workflow.publishedNumber === null ||
      !canWorkflow(currentActor, "run", workflow.ownerId)
    )
      return err(ERROR_IDS.WORKFLOW_DENIED);
    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowId, workflow.id),
          eq(workflowVersions.number, workflow.publishedNumber),
        ),
      );
    const trigger = version?.definition.nodes.find((node) => node.type.startsWith("trigger."));
    if (version === undefined || trigger?.type !== "trigger.manual")
      return err(ERROR_IDS.WORKFLOW_NOT_READY);
    if (!executableDefinition(version.definition)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
    const key = and(
      eq(workflowRuns.workflowId, workflow.id),
      eq(workflowRuns.actorId, actor.id),
      eq(workflowRuns.requestKey, input.data.requestKey),
    );
    const [existing] = await tx.select().from(workflowRuns).where(key);
    if (existing !== undefined) {
      if (existing.mode !== input.data.mode || existing.trigger.recordId !== input.data.recordId)
        return err(ERROR_IDS.WORKFLOW_CONFLICT);
      return ok(existing);
    }
    const [run] = await tx
      .insert(workflowRuns)
      .values({
        workflowId: workflow.id,
        versionId: version.id,
        actorId: actor.id,
        requestKey: input.data.requestKey,
        mode: input.data.mode,
        trigger: { recordId: input.data.recordId },
        nextNodeId: trigger.id,
      })
      .returning();
    signal.throwIfAborted();
    return run === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(run);
  });
}
