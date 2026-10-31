import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { validateDefinition } from "./definition";
import { definitionSchema } from "./schemas";

const nameSchema = z.string().trim().min(1).max(120);
const createSchema = z.strictObject({ name: nameSchema, definition: z.unknown() });
const saveSchema = createSchema.extend({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
});

export async function createWorkflow(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!canWorkflow(actor, "create")) return err(ERROR_IDS.WORKFLOW_DENIED);
  const input = createSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const definition = definitionSchema.safeParse(input.data.definition);
  if (!definition.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const [row] = await db
    .insert(workflows)
    .values({
      ownerId: actor.id,
      name: input.data.name,
      draft: definition.data,
    })
    .returning();
  signal.throwIfAborted();
  return row === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(row);
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
  const [current] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, input.data.id), isNull(workflows.archivedAt)));
  signal.throwIfAborted();
  if (current === undefined || !canWorkflow(actor, "edit", current.ownerId))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const [saved] = await db
    .update(workflows)
    .set({
      name: input.data.name,
      draft: definition.data,
      revision: input.data.revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(workflows.id, current.id), eq(workflows.revision, input.data.revision)))
    .returning();
  signal.throwIfAborted();
  return saved === undefined ? err(ERROR_IDS.WORKFLOW_CONFLICT) : ok(saved);
}

export async function publishWorkflow(
  db: Db,
  actor: PermSetUser,
  id: string,
  revision: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!z.string().uuid().safeParse(id).success || !Number.isSafeInteger(revision) || revision < 1)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), isNull(workflows.archivedAt)))
      .for("update");
    signal.throwIfAborted();
    if (current === undefined || !canWorkflow(actor, "publish", current.ownerId))
      return err(ERROR_IDS.WORKFLOW_DENIED);
    if (current.revision !== revision) return err(ERROR_IDS.WORKFLOW_CONFLICT);
    const definition = validateDefinition(current.draft);
    if (!definition.ok) return err(ERROR_IDS.WORKFLOW_INVALID);
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
        publishedBy: actor.id,
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
