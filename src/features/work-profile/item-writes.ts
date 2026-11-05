import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users, visibilityGroups } from "@/db/schema/identity";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import type { ItemDraft, WorkCommand } from "./contracts";
import { fail } from "./errors";
import { allowed, referenceSession, visible, type WorkActor } from "./policy";
import { itemDto } from "./read";
import { workItems, workStages, workTypes } from "./schema";
import { validateWorkValues, validDate } from "./values";

async function validate(db: Db, actor: WorkActor, item: ItemDraft, signal: AbortSignal) {
  const [type] = await db.select().from(workTypes).where(eq(workTypes.id, item.typeId));
  signal.throwIfAborted();
  const [stage] = await db.select().from(workStages).where(eq(workStages.id, item.stageId));
  signal.throwIfAborted();
  if (!type || type.isArchived || !stage || stage.typeId !== type.id || stage.isArchived)
    fail("invalid_input");
  if (
    !validateWorkValues(type.fields, item.values).ok ||
    (item.dueDate !== null && !validDate(item.dueDate))
  )
    fail("invalid_input");
  const [owner] = await db.select().from(users).where(eq(users.id, item.ownerId));
  signal.throwIfAborted();
  if (owner?.isActive !== true) fail("invalid_input");
  if (item.visibilityGroupId !== null) {
    const [group] = await db
      .select()
      .from(visibilityGroups)
      .where(eq(visibilityGroups.id, item.visibilityGroupId));
    signal.throwIfAborted();
    if (!group || (actor.type !== "admin" && !actor.groupIds.has(group.id))) fail("forbidden");
  }
  for (const [kind, id] of [
    ["organization", item.organizationId],
    ["person", item.personId],
    ["deal", item.dealId],
  ] as const) {
    if (
      id !== null &&
      !(await assertReferenceVisible(db, referenceSession(actor), { kind, id }, signal)).ok
    )
      fail("not_found");
  }
}
export async function writeItem(
  db: Db,
  actor: WorkActor,
  input: Extract<WorkCommand, { action: "create_item" | "update_item" | "archive_item" }>,
  signal: AbortSignal,
) {
  if (!allowed(actor, input.action === "create_item" ? "work.create" : "work.change"))
    fail("forbidden");
  if (input.action === "create_item") {
    if (input.item.ownerId !== actor.id && !allowed(actor, "work.manage")) fail("forbidden");
    await validate(db, actor, input.item, signal);
    const [row] = await db.insert(workItems).values(input.item).returning();
    signal.throwIfAborted();
    if (!row) fail("unavailable");
    return itemDto(row);
  }
  const [existing] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, input.id))
    .for("update");
  signal.throwIfAborted();
  if (!existing || !visible(actor, existing)) fail("not_found");
  if (existing.revision !== input.expectedRevision) fail("conflict");
  if (input.action === "archive_item") return writeArchive(db, existing, input.archived, signal);
  return updateItem(db, actor, existing, input.item, signal);
}

async function writeArchive(
  db: Db,
  existing: typeof workItems.$inferSelect,
  archived: boolean,
  signal: AbortSignal,
) {
  if (!archived) {
    const [configuration] = await db
      .select({
        typeArchived: workTypes.isArchived,
        stageArchived: workStages.isArchived,
        ownerActive: users.isActive,
      })
      .from(workStages)
      .innerJoin(workTypes, eq(workTypes.id, workStages.typeId))
      .innerJoin(users, eq(users.id, existing.ownerId))
      .where(and(eq(workStages.id, existing.stageId), eq(workStages.typeId, existing.typeId)));
    signal.throwIfAborted();
    if (
      !configuration ||
      configuration.typeArchived ||
      configuration.stageArchived ||
      !configuration.ownerActive
    )
      fail("in_use");
  }

  const [row] = await db
    .update(workItems)
    .set({ isArchived: archived, revision: existing.revision + 1, updatedAt: new Date() })
    .where(eq(workItems.id, existing.id))
    .returning();
  signal.throwIfAborted();
  if (!row) fail("unavailable");
  return itemDto(row);
}

async function updateItem(
  db: Db,
  actor: WorkActor,
  existing: typeof workItems.$inferSelect,
  item: ItemDraft,
  signal: AbortSignal,
) {
  if (existing.isArchived || item.typeId !== existing.typeId) fail("invalid_input");
  if (
    (item.ownerId !== existing.ownerId ||
      item.visibility !== existing.visibility ||
      item.visibilityGroupId !== existing.visibilityGroupId) &&
    actor.id !== existing.ownerId &&
    !allowed(actor, "work.manage")
  )
    fail("forbidden");
  if (item.ownerId !== existing.ownerId && !allowed(actor, "work.manage")) fail("forbidden");
  await validate(db, actor, item, signal);
  const [row] = await db
    .update(workItems)
    .set({ ...item, revision: existing.revision + 1, updatedAt: new Date() })
    .where(eq(workItems.id, existing.id))
    .returning();
  signal.throwIfAborted();
  if (!row) fail("unavailable");
  return itemDto(row);
}
