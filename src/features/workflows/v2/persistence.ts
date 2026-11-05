import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { workflowsV2, workflowV2Versions } from "@/db/schema/workflowV2";
import type {
  WorkflowV2Adapters,
  WorkflowV2Definition,
  WorkflowV2LibraryEntry,
  WorkflowV2PublishedManualLaunch,
  WorkflowV2Trigger,
} from "@/features/blocks/contracts";
import { parseWorkflowV2Draft, validateWorkflowV2 } from "@/features/blocks/validation";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "../access";
import { nativeObjectName } from "./nativeFields";
import { validWorkflowV2Trigger, workflowV2Readiness } from "./readiness";
import { authorizedWorkflow, documentDto, V2_ERROR } from "./shared";

const command = z.strictObject({ id: z.uuid(), expectedRevision: z.number().int().positive() });
const named = z.strictObject({
  name: z.string().trim().min(1).max(120),
  definition: z.unknown().optional(),
});
const empty: WorkflowV2Definition = {
  schemaVersion: 2,
  trigger: { type: "manual", config: {} },
  nodes: [],
  edges: [],
  entryNodeIds: [],
};

function manualLaunch(trigger?: WorkflowV2Trigger): WorkflowV2PublishedManualLaunch | undefined {
  if (trigger?.type !== "manual") return undefined;
  const { availability, objectName } = trigger.config;
  if (availability === undefined || availability === "global") return { availability: "global" };
  if ((availability === "single" || availability === "bulk") && nativeObjectName(objectName))
    return { availability, objectName };
  return undefined;
}

export async function documentWithPublishedLaunch(
  db: Db,
  row: typeof workflowsV2.$inferSelect,
  actor: PermSetUser,
  signal: AbortSignal,
) {
  if (row.publishedNumber === null || !canWorkflow(actor, "run", row.ownerId))
    return documentDto(row, actor);
  const version = await publishedWorkflowV2(db, row.id, row.publishedNumber);
  signal.throwIfAborted();
  return documentDto(row, actor, manualLaunch(version?.definition.trigger));
}

export async function createWorkflowV2(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = named.safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  const definition = parseWorkflowV2Draft(input.data.definition ?? empty);
  if (!definition.ok) return definition;
  return db.transaction(async (tx) => {
    const current = await hydrateActor(tx, actor.id, signal);
    if (current === null || !canWorkflow(current, "create")) return err(V2_ERROR.denied);
    const [row] = await tx
      .insert(workflowsV2)
      .values({ ownerId: current.id, name: input.data.name, draft: definition.value })
      .returning();
    return row === undefined ? err(V2_ERROR.write) : ok(documentDto(row, current));
  });
}
export async function saveWorkflowV2(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = command.extend({ name: named.shape.name, definition: z.unknown() }).safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  const definition = parseWorkflowV2Draft(input.data.definition);
  if (!definition.ok) return definition;
  return db.transaction(async (tx) => {
    const access = await authorizedWorkflow(tx, actor, input.data.id, "edit", signal, true);
    if (!access.ok) return access;
    if (access.value.workflow.revision !== input.data.expectedRevision)
      return err(V2_ERROR.conflict);
    if (access.value.workflow.archivedAt !== null) return err(V2_ERROR.inactive);
    const [row] = await tx
      .update(workflowsV2)
      .set({
        name: input.data.name,
        draft: definition.value,
        revision: input.data.expectedRevision + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowsV2.id, input.data.id))
      .returning();
    return row === undefined
      ? err(V2_ERROR.write)
      : ok(await documentWithPublishedLaunch(tx, row, access.value.actor, signal));
  });
}
export async function publishWorkflowV2(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  const input = command.safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  return db.transaction(async (tx) => {
    const access = await authorizedWorkflow(tx, actor, input.data.id, "publish", signal, true);
    if (!access.ok) return access;
    const { workflow, currentActor } = {
      workflow: access.value.workflow,
      currentActor: access.value.actor,
    };
    if (workflow.revision !== input.data.expectedRevision) return err(V2_ERROR.conflict);
    if (workflow.archivedAt !== null) return err(V2_ERROR.inactive);
    const definition = validateWorkflowV2(workflow.draft);
    if (!definition.ok || definition.value.nodes.length === 0) return err(V2_ERROR.invalid);
    if (!validWorkflowV2Trigger(definition.value.trigger)) return err(V2_ERROR.notReady);
    const readiness = await workflowV2Readiness(
      tx,
      currentActor,
      definition.value,
      adapters,
      signal,
    );
    if (Object.values(readiness).some((row) => row.state !== "ready"))
      return err(V2_ERROR.notReady);
    const number = (workflow.publishedNumber ?? 0) + 1;
    const [version] = await tx
      .insert(workflowV2Versions)
      .values({
        workflowId: workflow.id,
        number,
        name: workflow.name,
        definition: definition.value,
        publishedBy: currentActor.id,
      })
      .returning();
    const [row] = await tx
      .update(workflowsV2)
      .set({
        publishedNumber: number,
        active: true,
        revision: workflow.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowsV2.id, workflow.id))
      .returning();
    return version === undefined || row === undefined
      ? err(V2_ERROR.write)
      : ok({
          document: documentDto(row, currentActor, manualLaunch(version.definition.trigger)),
          version: {
            id: version.id,
            workflowId: version.workflowId,
            number: version.number,
            name: version.name,
            publishedBy: version.publishedBy,
            createdAt: version.createdAt.toISOString(),
          },
        });
  });
}
export async function readWorkflowV2(db: Db, actor: PermSetUser, id: string, signal: AbortSignal) {
  if (!z.uuid().safeParse(id).success) return err(V2_ERROR.invalid);
  const access = await authorizedWorkflow(db, actor, id, "view", signal);
  return access.ok
    ? ok(await documentWithPublishedLaunch(db, access.value.workflow, access.value.actor, signal))
    : access;
}
export async function listWorkflowV2(db: Db, actor: PermSetUser, signal: AbortSignal) {
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null || !canWorkflow(current, "view")) return err(V2_ERROR.denied);
  const rows = await db
    .select()
    .from(workflowsV2)
    .where(current.type === "admin" ? undefined : eq(workflowsV2.ownerId, current.id))
    .orderBy(desc(workflowsV2.updatedAt))
    .limit(200);
  return ok(rows.map((row) => documentDto(row) as WorkflowV2LibraryEntry));
}
export async function changeWorkflowV2State(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  action: "pause" | "archive" | "unarchive",
  signal: AbortSignal,
) {
  const input = command.safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  return db.transaction(async (tx) => {
    const access = await authorizedWorkflow(tx, actor, input.data.id, "edit", signal, true);
    if (!access.ok) return access;
    const row = access.value.workflow;
    if (row.revision !== input.data.expectedRevision) return err(V2_ERROR.conflict);
    const [saved] = await tx
      .update(workflowsV2)
      .set({
        active: false,
        archivedAt:
          action === "archive" ? new Date() : action === "unarchive" ? null : row.archivedAt,
        revision: row.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowsV2.id, row.id))
      .returning();
    return saved === undefined
      ? err(V2_ERROR.write)
      : ok(await documentWithPublishedLaunch(tx, saved, access.value.actor, signal));
  });
}
export async function duplicateWorkflowV2(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = z.strictObject({ id: z.uuid(), name: named.shape.name.optional() }).safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  const source = await authorizedWorkflow(db, actor, input.data.id, "view", signal);
  if (!source.ok) return source;
  return createWorkflowV2(
    db,
    actor,
    {
      name: input.data.name ?? `${source.value.workflow.name} (copy)`.slice(0, 120),
      definition: source.value.workflow.draft,
    },
    signal,
  );
}
export async function publishedWorkflowV2(db: Db, id: string, number: number) {
  const [row] = await db
    .select()
    .from(workflowV2Versions)
    .where(and(eq(workflowV2Versions.workflowId, id), eq(workflowV2Versions.number, number)))
    .limit(1);
  return row ?? null;
}
