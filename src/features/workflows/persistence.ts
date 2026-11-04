import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflows, workflowVersions } from "@/db/schema";
import { prepareCurrentCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { validateDefinition } from "./definition";
import {
  lifecycleStateError,
  lockWorkflowForCommand,
  workflowCommandSchema,
  workflowNameSchema,
} from "./lifecycleShared";
import { executableDefinition } from "./readiness";
import { definitionSchema } from "./schemas";

const createSchema = z.strictObject({ name: workflowNameSchema, definition: z.unknown() });
const saveSchema = workflowCommandSchema.extend(createSchema.shape);

export async function createWorkflow(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const input = createSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const definition = definitionSchema.safeParse(input.data.definition);
  if (!definition.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return db.transaction(async (tx) => {
    const currentActor = await hydrateActor(tx, actor.id, signal);
    if (currentActor === null || !canWorkflow(currentActor, "create"))
      return err(ERROR_IDS.WORKFLOW_DENIED);
    const [row] = await tx
      .insert(workflows)
      .values({
        ownerId: currentActor.id,
        name: input.data.name,
        draft: definition.data,
      })
      .returning();
    signal.throwIfAborted();
    return row === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(row);
  });
}

export async function saveWorkflowDraft(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const input = saveSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const definition = definitionSchema.safeParse(input.data.definition);
  if (!definition.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return db.transaction(async (tx) => {
    const locked = await lockWorkflowForCommand(tx, actor, input.data.id, "edit", signal);
    if (!locked.ok) return locked;
    const stateError = lifecycleStateError(locked.value.workflow, input.data.revision, false);
    if (stateError !== null) return err(stateError);
    const [saved] = await tx
      .update(workflows)
      .set({
        name: input.data.name,
        draft: definition.data,
        revision: input.data.revision + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(workflows.id, input.data.id), eq(workflows.revision, input.data.revision)))
      .returning();
    signal.throwIfAborted();
    return saved === undefined ? err(ERROR_IDS.WORKFLOW_CONFLICT) : ok(saved);
  });
}

export async function publishWorkflow(
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
    const locked = await lockWorkflowForCommand(tx, actor, id, "publish", signal);
    if (!locked.ok) return locked;
    const { workflow: current, actor: currentActor } = locked.value;
    const stateError = lifecycleStateError(current, revision, false);
    if (stateError !== null) return err(stateError);
    const shape = definitionSchema.safeParse(current.draft);
    if (!shape.success) return err(ERROR_IDS.WORKFLOW_INVALID);
    const metadata = shape.data.nodes.some((node) => node.type === "activity.create")
      ? {
          status: "complete" as const,
          defs: (await prepareCurrentCustomFieldValidation(tx, "activity", signal)).defs,
        }
      : { status: "complete" as const, defs: [] };
    const definition = validateDefinition(shape.data, metadata);
    if (!definition.ok) return err(ERROR_IDS.WORKFLOW_INVALID);
    if (!executableDefinition(definition.value)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
    if (current.publishedNumber !== null) {
      const [existing] = await tx
        .select()
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.workflowId, id),
            eq(workflowVersions.number, current.publishedNumber),
            eq(workflowVersions.name, current.name),
            sql`${workflowVersions.definition} = ${JSON.stringify(definition.value)}::jsonb`,
          ),
        );
      if (existing !== undefined) {
        await tx
          .update(workflows)
          .set({ active: true, updatedAt: new Date() })
          .where(eq(workflows.id, id));
        signal.throwIfAborted();
        return ok(existing);
      }
    }
    const number = (current.publishedNumber ?? 0) + 1;
    const [version] = await tx
      .insert(workflowVersions)
      .values({
        workflowId: id,
        number,
        name: current.name,
        definition: definition.value,
        publishedBy: currentActor.id,
      })
      .returning();
    await tx
      .update(workflows)
      .set({ publishedNumber: number, active: true, updatedAt: new Date() })
      .where(eq(workflows.id, id));
    signal.throwIfAborted();
    return version === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(version);
  });
}
