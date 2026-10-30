import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, notes, persons } from "@/db/schema";
import { deleteActivity } from "@/features/activities/activityDelete";
import { softDeleteNote } from "@/features/collaboration/notesRepo";
import { deleteOrg } from "@/features/contacts/deleteOrg";
import { deletePerson } from "@/features/contacts/deletePerson";
import { deleteDeal } from "@/features/deals/deleteDeal";
import { bulkUpdateLeads } from "@/features/leads/leadBulk";
import { assertNever } from "@/types/result";
import type { ImportActor } from "./commit";
import { toEntityCreateSession } from "./commitHelpers";
import { deleteMappingsForRecords, type ImportContext } from "./externalIds";
import { lockImportMutation } from "./importLock";
import { alreadyGone } from "./undoGone";
import type { ImportTarget } from "./wizardState";

// Tally of the org/person/note records an import created alongside its primary entities. `undone`
// is only claimed when every one of them came back out.
export interface SideRemoval {
  attempted: number;
  removed: number;
}

// One row's undo target: the created primary id (null for update-mode rows), plus the side-effect
// ids to remove. A record the row merely LINKED to carries a null id here and is never touched.
export interface UndoRow {
  id: string | null;
  orgId: string | null;
  personId: string | null;
  noteId: string | null;
}

// Remove the contacts a row created as a side effect of linking. A contact already soft-deleted by
// a prior undo attempt counts as removed (the delete authority 404s on it, but it IS gone).
async function removeSideContacts(
  db: Db,
  actor: ImportActor,
  row: UndoRow,
  side: SideRemoval,
  removedIds: string[],
  signal: AbortSignal,
): Promise<void> {
  if (row.personId !== null) {
    const r = await deletePerson(db, actor, row.personId, signal);
    side.attempted += 1;
    if (r.ok) removedIds.push(row.personId);
    if (r.ok || (await alreadyGone(db, "person", row.personId, signal))) side.removed += 1;
  }
  if (row.orgId !== null) {
    const r = await deleteOrg(db, actor, row.orgId, signal);
    side.attempted += 1;
    if (r.ok) removedIds.push(row.orgId);
    if (r.ok || (await alreadyGone(db, "organization", row.orgId, signal))) {
      side.removed += 1;
      await clearOrgLinks(db, row.orgId, signal);
    }
  }
}

// An import-created org that gets removed may still be referenced: an "update"-mode row that
// matched a pre-existing person/deal linked it to this new org, and that record survives undo. The
// org never existed before this import, so any live reference to it came FROM this import and is
// now dangling; null it out. A record the import deleted (its own primary) is unaffected.
async function clearOrgLinks(db: Db, orgId: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await db
    .update(persons)
    .set({ orgId: null })
    .where(and(eq(persons.orgId, orgId), isNull(persons.deletedAt)));
  await db
    .update(deals)
    .set({ orgId: null })
    .where(and(eq(deals.orgId, orgId), isNull(deals.deletedAt)));
}

// Soft-delete a note THIS IMPORT created, by the id the row recorded. Returns true when the note is
// gone after the call, whether this call removed it or an earlier attempt already did.
//
// Not softDeleteNote: that authority gates on the note's parent being visible, and the parent was
// soft-deleted one line earlier, so it would always deny. Authorization is already established:
// undo is gated on data.import, the primary delete just succeeded under the actor's own per-entity
// permission, and the id comes from import_rows.created_note_id, so only a note this import created
// can ever be targeted.
async function softDeleteCreatedNote(db: Db, noteId: string): Promise<boolean> {
  const [row] = await db
    .update(notes)
    .set({ deletedAt: new Date() })
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .returning({ id: notes.id });
  if (row !== undefined) return true;
  // No live note matched: it never existed, or a prior attempt already deleted it. Only the latter
  // counts as removed.
  const [existing] = await db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId));
  return existing !== undefined;
}

// Route one created entity id to its target's soft-delete authority and report whether the record
// was actually removed by THIS call. A per-row permission denial is a skip, not a batch failure
// (undo is gated on data.import, distinct from the per-entity delete flags).
async function deleteOne(
  db: Db,
  actor: ImportActor,
  target: ImportTarget,
  id: string,
  signal: AbortSignal,
): Promise<boolean> {
  switch (target) {
    case "person":
      return (await deletePerson(db, actor, id, signal)).ok;
    case "organization":
      return (await deleteOrg(db, actor, id, signal)).ok;
    case "activity":
      return (await deleteActivity(db, actor, id, signal)).ok;
    case "deal":
      return (await deleteDeal(db, actor, id, signal)).ok;
    case "lead": {
      const r = await bulkUpdateLeads(
        db,
        toEntityCreateSession(actor),
        { ids: [id], change: { deleted: true } },
        signal,
      );
      return r.ok && r.value.updated > 0;
    }
    case "note":
      return (await softDeleteNote(db, actor, id, signal)).ok;
    default:
      return assertNever(target);
  }
}

export function undoOneRow(
  db: Db,
  actor: ImportActor,
  target: ImportTarget,
  row: UndoRow,
  side: SideRemoval,
  ctx: ImportContext,
  signal: AbortSignal,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockImportMutation(tx, signal);
    return undoRowLocked(tx, actor, target, row, side, ctx, signal);
  });
}

async function undoRowLocked(
  db: Db,
  actor: ImportActor,
  target: ImportTarget,
  row: UndoRow,
  side: SideRemoval,
  ctx: ImportContext,
  signal: AbortSignal,
): Promise<boolean> {
  const removedIds: string[] = [];
  if (row.id !== null) {
    const deleted = await deleteOne(db, actor, target, row.id, signal);
    if (deleted) removedIds.push(row.id);
    const primaryGone = deleted || (await alreadyGone(db, target, row.id, signal));
    // A live primary the actor could not delete: leave its side effects untouched.
    if (!primaryGone) return false;
  }

  if (row.noteId !== null) {
    side.attempted += 1;
    if (await softDeleteCreatedNote(db, row.noteId)) side.removed += 1;
  }
  await removeSideContacts(db, actor, row, side, removedIds, signal);
  if (ctx.source === "pipedrive") {
    await deleteMappingsForRecords(db, ctx.batchId, removedIds, signal);
  }
  return row.id !== null;
}
