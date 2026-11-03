import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import {
  lifecycleStateError,
  lockWorkflowForCommand,
  MAX_WORKFLOW_VERSION_NUMBER,
  workflowCommandSchema,
  workflowRevisionSchema,
} from "./lifecycleShared";
import { describeRunRecovery, readFailureHistories } from "./runRecovery";

export { listWorkflows } from "./library";

export async function getWorkflow(db: Db, actor: PermSetUser, id: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!z.string().uuid().safeParse(id).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const [row] = await db.select().from(workflows).where(eq(workflows.id, id));
  const currentActor = await hydrateActor(db, actor.id, signal);
  signal.throwIfAborted();
  if (row === undefined || currentActor === null || !canWorkflow(currentActor, "view", row.ownerId))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const archived = row.archivedAt !== null;
  const edit = canWorkflow(currentActor, "edit", row.ownerId);
  return ok({
    ...row,
    capabilities: {
      edit: !archived && edit,
      publish: !archived && canWorkflow(currentActor, "publish", row.ownerId),
      run: !archived && canWorkflow(currentActor, "run", row.ownerId),
      cancel: canWorkflow(currentActor, "cancel", row.ownerId),
      unarchive: archived && edit,
      duplicate: canWorkflow(currentActor, "create"),
      restore: !archived && edit,
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
  signal.throwIfAborted();
  const currentActor = await hydrateActor(db, actor.id, signal);
  if (currentActor === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  const workflow = await getWorkflow(db, currentActor, workflowId, signal);
  if (!workflow.ok) return workflow;
  const rows = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      mode: workflowRuns.mode,
      resumeAt: workflowRuns.resumeAt,
      versionId: workflowRuns.versionId,
      errorId: workflowRuns.errorId,
      createdAt: workflowRuns.createdAt,
      updatedAt: workflowRuns.updatedAt,
      run: workflowRuns,
      definition: workflowVersions.definition,
    })
    .from(workflowRuns)
    .leftJoin(
      workflowVersions,
      and(
        eq(workflowVersions.id, workflowRuns.versionId),
        eq(workflowVersions.workflowId, workflowRuns.workflowId),
      ),
    )
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(50);
  const failures = await readFailureHistories(
    db,
    rows.map((row) => row.id),
    signal,
  );
  const history = await Promise.all(
    rows.map(async ({ run, definition, ...row }) => {
      const steps = await db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, row.id))
        .orderBy(workflowSteps.completedAt);
      const recovery = await describeRunRecovery(
        db,
        currentActor,
        workflow.value,
        run,
        definition,
        steps,
        failures.get(row.id) ?? [],
        signal,
      );
      return {
        ...row,
        steps: steps.map(({ nodeId, simulated, completedAt }) => ({
          nodeId,
          simulated,
          completedAt,
        })),
        ...(recovery === null ? {} : { recovery }),
      };
    }),
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
  signal.throwIfAborted();
  if (!workflowCommandSchema.safeParse({ id, revision }).success)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  return db.transaction(async (tx) => {
    const locked = await lockWorkflowForCommand(tx, actor, id, "edit", signal);
    if (!locked.ok) return locked;
    if (!canWorkflow(locked.value.actor, "view", locked.value.workflow.ownerId))
      return err(ERROR_IDS.WORKFLOW_DENIED);
    const stateError = lifecycleStateError(locked.value.workflow, revision, false);
    if (stateError !== null) return err(stateError);
    const [row] = await tx
      .update(workflows)
      .set({ active: false, updatedAt: new Date(), revision: revision + 1 })
      .where(and(eq(workflows.id, id), eq(workflows.revision, revision)))
      .returning();
    signal.throwIfAborted();
    return row === undefined ? err(ERROR_IDS.WORKFLOW_CONFLICT) : ok(row);
  });
}

// Summaries are bounded and omit definition contents and publisher identity. An older
// known version remains available through the independently authorized exact lookup.
export async function readWorkflowVersions(
  db: Db,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
) {
  const workflow = await getWorkflow(db, actor, id, signal);
  if (!workflow.ok) return workflow;
  const versions = await db
    .select({
      id: workflowVersions.id,
      number: workflowVersions.number,
      name: workflowVersions.name,
      createdAt: workflowVersions.createdAt,
    })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, id))
    .orderBy(desc(workflowVersions.number))
    .limit(100);
  signal.throwIfAborted();
  return ok(versions);
}

const versionInput = z.strictObject({
  id: z.string().uuid(),
  versionNumber: workflowRevisionSchema,
});

export async function readWorkflowVersion(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const input = versionInput.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const workflow = await getWorkflow(db, actor, input.data.id, signal);
  if (!workflow.ok) return workflow;
  if (input.data.versionNumber > MAX_WORKFLOW_VERSION_NUMBER) return err(ERROR_IDS.WORKFLOW_DENIED);
  const [version] = await db
    .select({
      id: workflowVersions.id,
      number: workflowVersions.number,
      name: workflowVersions.name,
      createdAt: workflowVersions.createdAt,
      definition: workflowVersions.definition,
    })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, input.data.id),
        eq(workflowVersions.number, input.data.versionNumber),
      ),
    );
  signal.throwIfAborted();
  return version === undefined ? err(ERROR_IDS.WORKFLOW_DENIED) : ok(version);
}
