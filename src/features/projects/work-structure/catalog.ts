import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ProjectEstimatePoint, ProjectWorkStructure } from "./contracts";
import {
  internalProjectLabels as labels,
  internalProjectEstimatePoints as points,
  internalProjectEstimateScales as scales,
  internalProjectStructureSettings as settings,
} from "./schema";

export async function readProjectWorkStructure(
  db: Db,
  projectId: string,
): Promise<ProjectWorkStructure> {
  const [project] = await db
    .select({ revision: settings.revision, activeScaleId: settings.activeScaleId })
    .from(settings)
    .where(eq(settings.projectId, projectId));
  const projectLabels = await db
    .select({
      id: labels.id,
      name: labels.name,
      description: labels.description,
      color: labels.color,
      kind: labels.kind,
      parentId: labels.parentId,
      position: labels.position,
    })
    .from(labels)
    .where(eq(labels.projectId, projectId))
    .orderBy(asc(labels.position), asc(labels.id));
  const projectScales = await db
    .select({
      id: scales.id,
      name: scales.name,
      type: scales.type,
    })
    .from(scales)
    .where(eq(scales.projectId, projectId))
    .orderBy(asc(scales.name), asc(scales.id));
  const projectPoints = await db
    .select({
      id: points.id,
      scaleId: points.scaleId,
      value: points.value,
      description: points.description,
      position: points.position,
    })
    .from(points)
    .where(eq(points.projectId, projectId))
    .orderBy(asc(points.position), asc(points.id));
  const pointsByScale = new Map<string, ProjectEstimatePoint[]>();
  for (const { scaleId, ...point } of projectPoints) {
    const siblings = pointsByScale.get(scaleId);
    if (siblings === undefined) pointsByScale.set(scaleId, [point]);
    else siblings.push(point);
  }
  return {
    revision: project?.revision ?? 0,
    activeScaleId: project?.activeScaleId ?? null,
    labels: projectLabels,
    scales: projectScales.map((scale) => ({ ...scale, points: pointsByScale.get(scale.id) ?? [] })),
  };
}
