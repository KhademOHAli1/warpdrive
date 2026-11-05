import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { workflows } from "@/db/schema/workflows";
import { workflowV2Executions, workflowV2Runs, workflowV2Waits } from "@/db/schema/workflowV2";
import type { BlockOutput, WorkflowV2RunDetail } from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "../access";
import { authorizedWorkflow, runDto, V2_ERROR } from "./shared";

function safeRun(row: typeof workflowV2Runs.$inferSelect) {
  return {
    ...runDto(row),
    state: { queue: [], frames: [], outputs: {}, stepCount: row.state.stepCount },
    trigger: { redacted: true },
  };
}
export async function readWorkflowV2Run(
  db: Db,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
) {
  if (!z.uuid().safeParse(id).success) return err(V2_ERROR.invalid);
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null) return err(V2_ERROR.denied);
  const [run] = await db.select().from(workflowV2Runs).where(eq(workflowV2Runs.id, id));
  if (run === undefined || (run.actorId !== current.id && current.type !== "admin"))
    return err(V2_ERROR.denied);
  const access = await authorizedWorkflow(db, current, run.workflowId, "view", signal);
  if (!access.ok) return access;
  const executions = await db
    .select()
    .from(workflowV2Executions)
    .where(eq(workflowV2Executions.runId, id))
    .orderBy(workflowV2Executions.createdAt);
  const waits = await db
    .select()
    .from(workflowV2Waits)
    .where(eq(workflowV2Waits.runId, id))
    .orderBy(workflowV2Waits.createdAt);
  const detail: WorkflowV2RunDetail = {
    run: safeRun(run),
    executions: executions.map((row) => ({
      ...row,
      output: row.output === null ? null : { redacted: true },
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    waits: waits.map((row) => ({
      id: row.id,
      runId: row.runId,
      executionId: row.executionId,
      kind: row.kind,
      status: row.status,
      wakeAt: row.wakeAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      config: row.responderId === current.id ? formView(row.kind, row.config) : { redacted: true },
      output: row.output === null ? null : { redacted: true },
    })),
  };
  return ok(detail);
}
function formView(kind: string, config: BlockOutput): BlockOutput {
  return kind === "form"
    ? { fields: config.fields ?? [], instructions: config.instructions ?? "" }
    : kind === "chat"
      ? { title: config.title ?? "", message: config.message ?? "" }
      : {};
}
export async function listWorkflowV2Runs(
  db: Db,
  actor: PermSetUser,
  workflowId: string,
  signal: AbortSignal,
) {
  if (!z.uuid().safeParse(workflowId).success) return err(V2_ERROR.invalid);
  const access = await authorizedWorkflow(db, actor, workflowId, "view", signal);
  if (!access.ok) return access;
  const rows = await db
    .select()
    .from(workflowV2Runs)
    .where(
      and(
        eq(workflowV2Runs.workflowId, workflowId),
        access.value.actor.type === "admin"
          ? undefined
          : eq(workflowV2Runs.actorId, access.value.actor.id),
      ),
    )
    .orderBy(desc(workflowV2Runs.createdAt))
    .limit(100);
  return ok(rows.map(safeRun));
}
export async function resolveWorkflowEngine(
  db: Db,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
) {
  if (!z.uuid().safeParse(id).success) return err(V2_ERROR.invalid);
  const v2 = await authorizedWorkflow(db, actor, id, "view", signal);
  if (v2.ok) return ok(2 as const);
  const current = await hydrateActor(db, actor.id, signal);
  const [row] = await db.select().from(workflows).where(eq(workflows.id, id));
  return current !== null && row !== undefined && canWorkflow(current, "view", row.ownerId)
    ? ok(1 as const)
    : err(V2_ERROR.denied);
}
export async function cancelWorkflowV2Run(
  db: Db,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
) {
  if (!z.uuid().safeParse(id).success) return err(V2_ERROR.invalid);
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowV2Runs)
      .where(eq(workflowV2Runs.id, id))
      .for("update");
    if (run === undefined) return err(V2_ERROR.denied);
    const current = await hydrateActor(tx, actor.id, signal);
    if (current === null || (run.actorId !== current.id && current.type !== "admin"))
      return err(V2_ERROR.denied);
    const access = await authorizedWorkflow(tx, current, run.workflowId, "cancel", signal);
    if (!access.ok) return access;
    if (["queued", "running", "waiting"].includes(run.status)) {
      await tx
        .update(workflowV2Runs)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(workflowV2Runs.id, id));
      await tx
        .update(workflowV2Waits)
        .set({ status: "cancelled" })
        .where(and(eq(workflowV2Waits.runId, id), eq(workflowV2Waits.status, "open")));
    }
    return ok({ id });
  });
}
