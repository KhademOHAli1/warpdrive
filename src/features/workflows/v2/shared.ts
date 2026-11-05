import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { workflowsV2 } from "@/db/schema/workflowV2";
import type { WorkflowV2Document, WorkflowV2Run } from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow, type WorkflowCapability } from "../access";

export const V2_ERROR = {
  denied: "E_WORKFLOW_V2_DENIED",
  invalid: "E_WORKFLOW_V2_INVALID",
  conflict: "E_WORKFLOW_V2_CONFLICT",
  missing: "E_WORKFLOW_V2_NOT_FOUND",
  notReady: "E_WORKFLOW_V2_NOT_READY",
  inactive: "E_WORKFLOW_V2_INACTIVE",
  limit: "E_WORKFLOW_V2_LIMIT",
  write: "E_WORKFLOW_V2_WRITE_FAILED",
} as const;
export function documentDto(
  row: typeof workflowsV2.$inferSelect,
  actor?: PermSetUser,
): WorkflowV2Document {
  return {
    id: row.id,
    engineVersion: 2,
    ownerId: row.ownerId,
    name: row.name,
    revision: row.revision,
    active: row.active,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    publishedNumber: row.publishedNumber,
    updatedAt: row.updatedAt.toISOString(),
    draft: row.draft,
    ...(actor === undefined
      ? {}
      : {
          capabilities: {
            edit: canWorkflow(actor, "edit", row.ownerId),
            publish: canWorkflow(actor, "publish", row.ownerId),
            run: canWorkflow(actor, "run", row.ownerId),
            archive: canWorkflow(actor, "edit", row.ownerId),
          },
        }),
  };
}
export function runDto(row: {
  id: string;
  workflowId: string;
  versionId: string;
  actorId: string;
  mode: WorkflowV2Run["mode"];
  status: WorkflowV2Run["status"];
  state: WorkflowV2Run["state"];
  trigger: WorkflowV2Run["trigger"];
  errorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): WorkflowV2Run {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export async function authorizedWorkflow(
  db: Db,
  actor: PermSetUser,
  id: string,
  capability: WorkflowCapability,
  signal: AbortSignal,
  lock = false,
) {
  signal.throwIfAborted();
  const currentActor = await hydrateActor(db, actor.id, signal);
  if (currentActor === null) return err(V2_ERROR.denied);
  const query = db
    .select()
    .from(workflowsV2)
    .where(and(eq(workflowsV2.id, id)))
    .limit(1);
  const [workflow] = lock ? await query.for("update") : await query;
  if (workflow === undefined || !canWorkflow(currentActor, capability, workflow.ownerId))
    return err(V2_ERROR.denied);
  return ok({ actor: currentActor, workflow });
}
