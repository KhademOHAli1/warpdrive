import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ProjectItemStructure, ProjectItemStructurePatch } from "./contracts";
import {
  internalProjectItemEstimates as estimates,
  internalProjectItemLabels as itemLabels,
  internalProjectLabels as labels,
  internalProjectEstimatePoints as points,
  internalProjectStructureSettings as settings,
} from "./schema";

export { readProjectWorkStructure } from "./catalog";

export async function readProjectItemStructures(db: Db, projectId: string, itemId?: string) {
  const records = new Map<string, ProjectItemStructure>();
  const labelRows = await db
    .select({ itemId: itemLabels.itemId, labelId: itemLabels.labelId })
    .from(itemLabels)
    .where(
      and(
        eq(itemLabels.projectId, projectId),
        itemId === undefined ? undefined : eq(itemLabels.itemId, itemId),
      ),
    )
    .orderBy(asc(itemLabels.labelId));
  const estimateRows = await db
    .select({ itemId: estimates.itemId, pointId: estimates.pointId })
    .from(estimates)
    .where(
      and(
        eq(estimates.projectId, projectId),
        itemId === undefined ? undefined : eq(estimates.itemId, itemId),
      ),
    );
  for (const row of labelRows) {
    const value = records.get(row.itemId);
    if (value === undefined)
      records.set(row.itemId, { labelIds: [row.labelId], estimatePointId: null });
    else value.labelIds.push(row.labelId);
  }
  for (const row of estimateRows)
    records.set(row.itemId, {
      labelIds: records.get(row.itemId)?.labelIds ?? [],
      estimatePointId: row.pointId,
    });
  return records;
}

export async function validateProjectItemStructure(
  tx: Db,
  projectId: string,
  { labelIds, estimatePointId }: ProjectItemStructurePatch,
) {
  if (labelIds !== undefined && labelIds.length > 0) {
    const choices = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.projectId, projectId),
          eq(labels.kind, "label"),
          inArray(labels.id, labelIds),
        ),
      );
    if (choices.length !== labelIds.length) return false;
  }
  if (estimatePointId == null) return true;
  const [choice] = await tx
    .select({ id: points.id })
    .from(points)
    .innerJoin(
      settings,
      and(eq(settings.projectId, points.projectId), eq(settings.activeScaleId, points.scaleId)),
    )
    .where(and(eq(points.projectId, projectId), eq(points.id, estimatePointId)));
  return choice !== undefined;
}

export async function writeProjectItemStructure(
  tx: Db,
  projectId: string,
  itemId: string,
  { labelIds, estimatePointId }: ProjectItemStructurePatch,
) {
  if (labelIds !== undefined) {
    await tx
      .delete(itemLabels)
      .where(and(eq(itemLabels.projectId, projectId), eq(itemLabels.itemId, itemId)));
    if (labelIds.length > 0)
      await tx
        .insert(itemLabels)
        .values(labelIds.map((labelId) => ({ projectId, itemId, labelId })));
  }
  if (estimatePointId === undefined) return;
  if (estimatePointId === null) {
    await tx
      .delete(estimates)
      .where(and(eq(estimates.projectId, projectId), eq(estimates.itemId, itemId)));
  } else {
    await tx
      .insert(estimates)
      .values({ projectId, itemId, pointId: estimatePointId })
      .onConflictDoUpdate({
        target: [estimates.projectId, estimates.itemId],
        set: { pointId: estimatePointId },
      });
  }
}
