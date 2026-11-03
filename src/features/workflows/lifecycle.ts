import { and, eq } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { copyWorkflowDefinition } from "./copyDefinition";
import {
  lifecycleStateError,
  lockWorkflowForCommand,
  MAX_WORKFLOW_VERSION_NUMBER,
  workflowCommandSchema,
  workflowNameSchema,
  workflowRevisionSchema,
} from "./lifecycleShared";
import { definitionSchema } from "./schemas";

const duplicateSchema = workflowCommandSchema.extend({ name: workflowNameSchema });
const restoreSchema = workflowCommandSchema.extend({ versionNumber: workflowRevisionSchema });

async function lifecycleTransaction<T>(
  db: Db,
  signal: AbortSignal,
  command: (tx: Db) => Promise<T>,
) {
  signal.throwIfAborted();
  try {
    return await db.transaction(async (tx) => {
      signal.throwIfAborted();
      const result = await command(tx);
      signal.throwIfAborted();
      return result;
    });
  } catch (error) {
    // A cancelled command must reject with its original reason so the transaction
    // rolls back; it must never become a successful or ordinary failed command result.
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  }
}

export async function archiveWorkflow(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const input = workflowCommandSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return lifecycleTransaction(db, signal, async (tx) => {
    const locked = await lockWorkflowForCommand(tx, actor, input.data.id, "edit", signal);
    if (!locked.ok) return locked;
    const stateError = lifecycleStateError(locked.value.workflow, input.data.revision, false);
    if (stateError !== null) return err(stateError);
    const now = new Date();
    const [archived] = await tx
      .update(workflows)
      .set({
        archivedAt: now,
        active: false,
        revision: locked.value.workflow.revision + 1,
        updatedAt: now,
      })
      .where(eq(workflows.id, input.data.id))
      .returning();
    signal.throwIfAborted();
    return archived === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(archived);
  });
}

export async function unarchiveWorkflow(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const input = workflowCommandSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return lifecycleTransaction(db, signal, async (tx) => {
    const locked = await lockWorkflowForCommand(tx, actor, input.data.id, "edit", signal);
    if (!locked.ok) return locked;
    const stateError = lifecycleStateError(locked.value.workflow, input.data.revision, true);
    if (stateError !== null) return err(stateError);
    const [unarchived] = await tx
      .update(workflows)
      .set({
        archivedAt: null,
        active: false,
        revision: locked.value.workflow.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, input.data.id))
      .returning();
    signal.throwIfAborted();
    return unarchived === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(unarchived);
  });
}

export async function duplicateWorkflow(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
): Promise<
  | Result<typeof workflows.$inferSelect, string>
  | Extract<ReturnType<typeof copyWorkflowDefinition>, { ok: false }>
> {
  signal.throwIfAborted();
  const input = duplicateSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return lifecycleTransaction(db, signal, async (tx) => {
    const locked = await lockWorkflowForCommand(tx, actor, input.data.id, "view", signal, true);
    if (!locked.ok) return locked;
    const stateError = lifecycleStateError(locked.value.workflow, input.data.revision, "either");
    if (stateError !== null) return err(stateError);
    const definition = copyWorkflowDefinition(locked.value.workflow.draft);
    signal.throwIfAborted();
    if (!definition.ok) return definition;
    const [copy] = await tx
      .insert(workflows)
      .values({
        ownerId: locked.value.actor.id,
        name: input.data.name,
        draft: definition.value,
        revision: 1,
        active: false,
        archivedAt: null,
        publishedNumber: null,
      })
      .returning();
    signal.throwIfAborted();
    return copy === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(copy);
  });
}

export async function restoreWorkflowDraft(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const input = restoreSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return lifecycleTransaction(db, signal, async (tx) => {
    const locked = await lockWorkflowForCommand(tx, actor, input.data.id, "edit", signal);
    if (!locked.ok) return locked;
    const stateError = lifecycleStateError(locked.value.workflow, input.data.revision, false);
    if (stateError !== null) return err(stateError);
    if (input.data.versionNumber > MAX_WORKFLOW_VERSION_NUMBER)
      return err(ERROR_IDS.WORKFLOW_DENIED);
    const [version] = await tx
      .select({ name: workflowVersions.name, definition: workflowVersions.definition })
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowId, input.data.id),
          eq(workflowVersions.number, input.data.versionNumber),
        ),
      );
    signal.throwIfAborted();
    if (version === undefined) return err(ERROR_IDS.WORKFLOW_DENIED);
    const definition = definitionSchema.safeParse(version.definition);
    const name = workflowNameSchema.safeParse(version.name);
    if (!definition.success || !name.success) return err(ERROR_IDS.WORKFLOW_INVALID);
    const [restored] = await tx
      .update(workflows)
      .set({
        name: name.data,
        draft: definition.data,
        revision: locked.value.workflow.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, input.data.id))
      .returning();
    signal.throwIfAborted();
    return restored === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(restored);
  });
}
