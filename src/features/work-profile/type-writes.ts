import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { StageDraft, WorkCommand, WorkFieldDefinition } from "./contracts";
import { fail } from "./errors";
import { allowed, type WorkActor } from "./policy";
import { readTypes } from "./read";
import { workItems, workStages, workTypes } from "./schema";
import { validateWorkValues } from "./values";

type ConfigureType = Extract<WorkCommand, { action: "configure_type" }>;
type ArchiveType = Extract<WorkCommand, { action: "archive_type" }>;
type TypeRow = typeof workTypes.$inferSelect;
type StoredValues = Pick<typeof workItems.$inferSelect, "values" | "stageId">;

async function requireTypeDto(db: Db, id: string, signal: AbortSignal) {
  const type = (await readTypes(db, signal)).find((value) => value.id === id);
  if (!type) fail("unavailable");
  return type;
}

function validateConfiguration(input: ConfigureType) {
  if (
    new Set(input.fields.map((field) => field.key)).size !== input.fields.length ||
    new Set(input.stages.map((stage) => stage.key)).size !== input.stages.length ||
    !input.stages.some((stage) => stage.bucket === "open")
  )
    fail("invalid_input");
}

async function createType(db: Db, input: ConfigureType, signal: AbortSignal) {
  if (input.expectedRevision !== 0 || input.kind !== "custom") fail("invalid_input");
  const [row] = await db
    .insert(workTypes)
    .values({
      key: `custom_${randomUUID().replaceAll("-", "")}`,
      name: input.name,
      kind: "custom",
      fields: input.fields,
    })
    .returning();
  signal.throwIfAborted();
  if (!row) fail("unavailable");
  await db
    .insert(workStages)
    .values(input.stages.map((stage, order) => ({ ...stage, order, typeId: row.id })));
  signal.throwIfAborted();
  return requireTypeDto(db, row.id, signal);
}

async function archiveType(db: Db, input: ArchiveType, existing: TypeRow, signal: AbortSignal) {
  if (input.archived) {
    const [used] = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.typeId, existing.id), eq(workItems.isArchived, false)))
      .limit(1);
    signal.throwIfAborted();
    if (used) fail("in_use");
  }
  await db
    .update(workTypes)
    .set({ isArchived: input.archived, revision: existing.revision + 1, updatedAt: new Date() })
    .where(eq(workTypes.id, existing.id));
  signal.throwIfAborted();
  return requireTypeDto(db, existing.id, signal);
}

function protectStoredFields(
  previous: WorkFieldDefinition[],
  fields: WorkFieldDefinition[],
  items: StoredValues[],
) {
  for (const old of previous) {
    const next = fields.find((field) => field.key === old.key);
    if (
      items.some((item) => Object.hasOwn(item.values, old.key)) &&
      (!next || next.type !== old.type)
    )
      fail("in_use");
  }
  if (items.some((item) => !validateWorkValues(fields, item.values).ok)) fail("in_use");
}

async function replaceStages(
  db: Db,
  typeId: string,
  requested: StageDraft[],
  items: StoredValues[],
  signal: AbortSignal,
) {
  const stages = await db.select().from(workStages).where(eq(workStages.typeId, typeId));
  signal.throwIfAborted();
  const used = new Set(items.map((item) => item.stageId));
  for (const stage of stages) {
    const next = requested.find((value) => value.key === stage.key);
    if (used.has(stage.id) && (!next || next.bucket !== stage.bucket)) fail("in_use");
    if (!next) {
      await db.delete(workStages).where(eq(workStages.id, stage.id));
      signal.throwIfAborted();
    }
  }
  for (const [order, stage] of requested.entries()) {
    const current = stages.find((value) => value.key === stage.key);
    if (current)
      await db
        .update(workStages)
        .set({ ...stage, order })
        .where(eq(workStages.id, current.id));
    else await db.insert(workStages).values({ ...stage, order, typeId });
    signal.throwIfAborted();
  }
}

async function updateType(db: Db, input: ConfigureType, existing: TypeRow, signal: AbortSignal) {
  if (input.kind !== existing.kind || existing.isArchived) fail("invalid_input");
  const items = await db
    .select({ values: workItems.values, stageId: workItems.stageId })
    .from(workItems)
    .where(eq(workItems.typeId, existing.id));
  signal.throwIfAborted();
  protectStoredFields(existing.fields, input.fields, items);
  await replaceStages(db, existing.id, input.stages, items, signal);
  await db
    .update(workTypes)
    .set({
      name: input.name,
      fields: input.fields,
      revision: existing.revision + 1,
      updatedAt: new Date(),
    })
    .where(eq(workTypes.id, existing.id));
  signal.throwIfAborted();
  return requireTypeDto(db, existing.id, signal);
}

export async function writeType(
  db: Db,
  actor: WorkActor,
  input: ConfigureType | ArchiveType,
  signal: AbortSignal,
) {
  if (!allowed(actor, "work.manage")) fail("forbidden");
  if (input.action === "configure_type") {
    validateConfiguration(input);
    if (input.id === undefined) return createType(db, input, signal);
  }
  const id = input.id;
  if (id === undefined || id === "") fail("invalid_input");
  const [existing] = await db.select().from(workTypes).where(eq(workTypes.id, id)).for("update");
  signal.throwIfAborted();
  if (!existing) fail("not_found");
  if (existing.revision !== input.expectedRevision) fail("conflict");
  return input.action === "archive_type"
    ? archiveType(db, input, existing, signal)
    : updateType(db, input, existing, signal);
}
