import { and, eq, exists, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { internalProjectItems as items } from "../schema";
import { bumpStructureItemRevisions, changeProjectWorkStructure } from "./access";
import {
  type ProjectEstimatePoint,
  type ProjectEstimateScale,
  projectEstimateScalesMaxCount,
  type SaveProjectEstimateScale,
  type SetProjectEstimateScale,
} from "./contracts";
import { saveProjectEstimateScaleInput } from "./input";
import {
  internalProjectEstimatePoints as points,
  internalProjectItemEstimates as records,
  internalProjectEstimateScales as scales,
  internalProjectStructureSettings as settings,
} from "./schema";

type Replacement = NonNullable<SaveProjectEstimateScale["replacements"]>[number];

export function setProjectEstimateScale(
  db: Db,
  who: NativeSessionRef,
  input: SetProjectEstimateScale,
  signal: AbortSignal,
) {
  return changeProjectWorkStructure(db, who, input, signal, (_tx, before) => {
    const { scaleId } = input;
    if (scaleId === before.activeScaleId) return ok(null);
    return scaleId === null || before.scales.some(({ id }) => id === scaleId)
      ? ok({ activeScaleId: scaleId })
      : err("project_invalid");
  });
}

function normalizePoints(points: ProjectEstimatePoint[]) {
  return [...points]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((point, position) => ({ ...point, position }));
}

function sameScale(next: ProjectEstimateScale, current: ProjectEstimateScale | undefined) {
  return (
    current !== undefined &&
    current.name === next.name &&
    current.type === next.type &&
    current.points.length === next.points.length &&
    next.points.every((point, position) => {
      const old = current.points[position];
      return (
        old !== undefined &&
        old.id === point.id &&
        old.value === point.value &&
        old.description === point.description &&
        old.position === point.position
      );
    })
  );
}

async function bumpRemovedPointItems(tx: Db, projectId: string, removed: string[]) {
  const target = and(
    eq(items.projectId, projectId),
    exists(
      tx
        .select({ pointId: records.pointId })
        .from(records)
        .where(
          and(
            eq(records.projectId, projectId),
            eq(records.itemId, items.id),
            inArray(records.pointId, removed),
          ),
        ),
    ),
  );
  return bumpStructureItemRevisions(tx, target);
}

async function removePoints(
  tx: Db,
  projectId: string,
  removed: string[],
  replacements: Replacement[],
) {
  if (removed.length === 0) return;
  for (const { pointId, replacementPointId } of replacements)
    await tx
      .update(records)
      .set({ pointId: replacementPointId })
      .where(and(eq(records.projectId, projectId), eq(records.pointId, pointId)));
  await tx
    .delete(records)
    .where(and(eq(records.projectId, projectId), inArray(records.pointId, removed)));
  await tx.delete(points).where(and(eq(points.projectId, projectId), inArray(points.id, removed)));
}

async function writeScale(
  tx: Db,
  projectId: string,
  { id, name, type, points: next }: ProjectEstimateScale,
) {
  await tx
    .insert(scales)
    .values({ projectId, id, name, type })
    .onConflictDoUpdate({ target: [scales.projectId, scales.id], set: { name, type } });
  await tx
    .insert(points)
    .values(next.map((point) => ({ projectId, scaleId: id, ...point })))
    .onConflictDoUpdate({
      target: [points.projectId, points.id],
      set: {
        value: sql`excluded.value`,
        description: sql`excluded.description`,
        position: sql`excluded.position`,
      },
    });
}

export function saveProjectEstimateScale(
  db: Db,
  who: NativeSessionRef,
  input: SaveProjectEstimateScale,
  signal: AbortSignal,
) {
  return changeProjectWorkStructure(db, who, input, signal, async (tx, before) => {
    const parsed = saveProjectEstimateScaleInput.safeParse(input);
    if (!parsed.success) return err("project_invalid");
    const { projectId, scaleId, scale, replacements = [] } = parsed.data;
    const current = before.scales.find(({ id }) => id === scaleId);
    if (scale === null && current === undefined) return err("project_unavailable");
    const next =
      scale === null ? null : { ...scale, id: scaleId, points: normalizePoints(scale.points) };
    const other = before.scales.filter(({ id }) => id !== scaleId);
    if (next !== null && !validScaleChange(next, other)) return err("project_invalid");
    const nextIds = new Set(next?.points.map(({ id }) => id));
    const removed = (current?.points ?? []).map(({ id }) => id).filter((id) => !nextIds.has(id));
    if (
      replacements.some(
        ({ pointId, replacementPointId }) =>
          !removed.includes(pointId) || !nextIds.has(replacementPointId),
      )
    )
      return err("project_invalid");
    if (next !== null && sameScale(next, current)) return ok(null);
    if (removed.length > 0 && !(await bumpRemovedPointItems(tx, projectId, removed)))
      return err("project_conflict");
    if (next !== null) {
      await writeScale(tx, projectId, next);
      await removePoints(tx, projectId, removed, replacements);
      return ok({});
    }
    if (before.activeScaleId === scaleId)
      await tx
        .update(settings)
        .set({ activeScaleId: null })
        .where(eq(settings.projectId, projectId));
    await removePoints(tx, projectId, removed, []);
    await tx.delete(scales).where(and(eq(scales.projectId, projectId), eq(scales.id, scaleId)));
    return ok({ activeScaleId: before.activeScaleId === scaleId ? null : before.activeScaleId });
  });
}

function validScaleChange(next: ProjectEstimateScale, other: ProjectEstimateScale[]) {
  if (other.length >= projectEstimateScalesMaxCount) return false;
  if (other.some(({ name }) => name.toLowerCase() === next.name.toLowerCase())) return false;
  const unavailableIds = new Set(other.flatMap(({ points }) => points.map(({ id }) => id)));
  return next.points.every(({ id }) => !unavailableIds.has(id));
}
