import { and, eq, exists, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { internalProjectItems } from "../schema";
import { bumpStructureItemRevisions, changeProjectWorkStructure } from "./access";
import type { ProjectLabel, SaveProjectLabels } from "./contracts";
import { saveProjectLabelsInput } from "./input";
import { internalProjectLabels as labels, internalProjectItemLabels as records } from "./schema";

function normalizedLabels(labels: ProjectLabel[]) {
  const count = new Map<string | null, number>();
  const sorted = [...labels].sort(
    (left, right) =>
      (left.parentId ?? "").localeCompare(right.parentId ?? "") ||
      left.position - right.position ||
      left.id.localeCompare(right.id),
  );
  return sorted.map((label) => {
    const position = count.get(label.parentId) ?? 0;
    count.set(label.parentId, position + 1);
    return { ...label, position };
  });
}

function sameLabel(left: ProjectLabel, right: ProjectLabel | undefined) {
  return (
    right !== undefined &&
    left.id === right.id &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.description === right.description &&
    left.color === right.color &&
    left.parentId === right.parentId &&
    left.position === right.position
  );
}

async function unlinkDeletedLabels(tx: Db, projectId: string, removed: string[]) {
  const deleting = and(eq(records.projectId, projectId), inArray(records.labelId, removed));
  const affected = and(
    eq(internalProjectItems.projectId, projectId),
    exists(
      tx
        .select({ id: records.itemId })
        .from(records)
        .where(and(deleting, eq(records.itemId, internalProjectItems.id))),
    ),
  );
  if (!(await bumpStructureItemRevisions(tx, affected))) return false;
  await tx.delete(records).where(deleting);
  return true;
}

export function saveProjectLabels(
  db: Db,
  who: NativeSessionRef,
  input: SaveProjectLabels,
  signal: AbortSignal,
) {
  return changeProjectWorkStructure(db, who, input, signal, async (tx, before) => {
    const validated = saveProjectLabelsInput.safeParse(input);
    if (!validated.success) return err("project_invalid");
    const { projectId } = validated.data;
    const next = normalizedLabels(validated.data.labels);
    const previous = new Map(before.labels.map((label) => [label.id, label]));
    const nextById = new Map(next.map((label) => [label.id, label]));
    if (next.some((label) => previous.has(label.id) && previous.get(label.id)?.kind !== label.kind))
      return err("project_invalid");
    const changed = next.filter((label) => !sameLabel(label, previous.get(label.id)));
    const removed = before.labels.filter(({ id }) => !nextById.has(id));
    if (changed.length === 0 && removed.length === 0) return ok(null);
    const removedLeaves = removed.filter(({ kind }) => kind === "label").map(({ id }) => id);
    if (removedLeaves.length > 0 && !(await unlinkDeletedLabels(tx, projectId, removedLeaves)))
      return err("project_conflict");
    if (changed.length > 0)
      await tx
        .insert(labels)
        .values(changed.map((label) => ({ projectId, ...label })))
        .onConflictDoUpdate({
          target: [labels.projectId, labels.id],
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            color: sql`excluded.color`,
            parentId: sql`excluded.parent_id`,
            position: sql`excluded.position`,
          },
        });
    if (removedLeaves.length > 0)
      await tx
        .delete(labels)
        .where(and(eq(labels.projectId, projectId), inArray(labels.id, removedLeaves)));
    const removedGroups = removed.filter(({ kind }) => kind === "group").map(({ id }) => id);
    if (removedGroups.length > 0)
      await tx
        .delete(labels)
        .where(and(eq(labels.projectId, projectId), inArray(labels.id, removedGroups)));
    return ok({});
  });
}
