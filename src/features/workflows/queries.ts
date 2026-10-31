import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, workflows } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";

export async function listWorkflows(db: Db, actor: PermSetUser, signal: AbortSignal) {
  if (!canWorkflow(actor, "view")) return err(ERROR_IDS.WORKFLOW_DENIED);
  const rows = await db
    .select({
      id: workflows.id,
      name: workflows.name,
      active: workflows.active,
      publishedNumber: workflows.publishedNumber,
      updatedAt: workflows.updatedAt,
    })
    .from(workflows)
    .where(
      and(
        isNull(workflows.archivedAt),
        actor.type === "admin" ? undefined : eq(workflows.ownerId, actor.id),
      ),
    )
    .orderBy(desc(workflows.updatedAt))
    .limit(100);
  signal.throwIfAborted();
  return ok(rows);
}

export async function getWorkflow(db: Db, actor: PermSetUser, id: string, signal: AbortSignal) {
  if (!z.string().uuid().safeParse(id).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), isNull(workflows.archivedAt)));
  signal.throwIfAborted();
  if (row === undefined || !canWorkflow(actor, "view", row.ownerId))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  return ok({
    ...row,
    capabilities: {
      edit: canWorkflow(actor, "edit", row.ownerId),
      publish: canWorkflow(actor, "publish", row.ownerId),
      run: canWorkflow(actor, "run", row.ownerId),
      cancel: canWorkflow(actor, "cancel", row.ownerId),
    },
  });
}

// History intentionally excludes trigger values and recorded CRM outputs. Historical visibility
// can change; inspecting payloads will require reauthorization for every referenced record.
export async function readRunHistory(
  db: Db,
  actor: PermSetUser,
  workflowId: string,
  signal: AbortSignal,
) {
  const workflow = await getWorkflow(db, actor, workflowId, signal);
  if (!workflow.ok) return workflow;
  const rows = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      mode: workflowRuns.mode,
      versionId: workflowRuns.versionId,
      errorId: workflowRuns.errorId,
      createdAt: workflowRuns.createdAt,
      updatedAt: workflowRuns.updatedAt,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(50);
  const history = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      steps: await db
        .select({
          nodeId: workflowSteps.nodeId,
          simulated: workflowSteps.simulated,
          completedAt: workflowSteps.completedAt,
        })
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, row.id))
        .orderBy(workflowSteps.completedAt),
    })),
  );
  signal.throwIfAborted();
  return ok(history);
}

export async function pauseWorkflow(
  db: Db,
  actor: PermSetUser,
  id: string,
  revision: number,
  signal: AbortSignal,
) {
  const workflow = await getWorkflow(db, actor, id, signal);
  if (!workflow.ok) return workflow;
  if (!workflow.value.capabilities.edit) return err(ERROR_IDS.WORKFLOW_DENIED);
  const [row] = await db
    .update(workflows)
    .set({ active: false, updatedAt: new Date(), revision: revision + 1 })
    .where(and(eq(workflows.id, id), eq(workflows.revision, revision)))
    .returning();
  signal.throwIfAborted();
  return row === undefined ? err(ERROR_IDS.WORKFLOW_CONFLICT) : ok(row);
}
