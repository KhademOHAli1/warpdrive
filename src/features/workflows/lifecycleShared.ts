import { eq } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflows } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow, type WorkflowCapability } from "./access";

export const workflowNameSchema = z.string().trim().min(1).max(120);
export const workflowRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Stored immutable version numbers use PostgreSQL integer. Larger safe inputs can
// never identify a version and must not reach an int4 parameter cast.
export const MAX_WORKFLOW_VERSION_NUMBER = 2_147_483_647;
export const workflowCommandSchema = z.strictObject({
  id: z.string().uuid(),
  revision: workflowRevisionSchema,
});

// Call inside the command transaction. All lifecycle writers decide against the same
// locked row, using current database authority rather than a caller's permission snapshot.
export async function lockWorkflowForCommand(
  db: Db,
  actor: PermSetUser,
  id: string,
  capability: WorkflowCapability,
  signal: AbortSignal,
  requiresCreate = false,
): Promise<Result<{ workflow: typeof workflows.$inferSelect; actor: PermSetUser }, string>> {
  signal.throwIfAborted();
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id)).for("update");
  signal.throwIfAborted();
  const currentActor = await hydrateActor(db, actor.id, signal);
  signal.throwIfAborted();
  if (
    workflow === undefined ||
    currentActor === null ||
    !canWorkflow(currentActor, capability, workflow.ownerId) ||
    (requiresCreate && !canWorkflow(currentActor, "create"))
  ) {
    return err(ERROR_IDS.WORKFLOW_DENIED);
  }
  return ok({ workflow, actor: currentActor });
}

// Authority must already be established. An old expected revision remains a conflict
// even when the intervening command also changed the archive state.
export function lifecycleStateError(
  workflow: typeof workflows.$inferSelect,
  revision: number,
  archived: boolean | "either",
): string | null {
  if (workflow.revision !== revision) return ERROR_IDS.WORKFLOW_CONFLICT;
  if (archived !== "either" && (workflow.archivedAt !== null) !== archived)
    return ERROR_IDS.WORKFLOW_DENIED;
  return null;
}
