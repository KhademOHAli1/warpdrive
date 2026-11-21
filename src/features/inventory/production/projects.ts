import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lockInternalProject } from "@/features/projects/access";
import { internalProjectItems, internalProjectStates } from "@/features/projects/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import { createInventoryProjectTasks, inventoryProjectsEnabled } from "../projectBridge";
import { inventoryTemplates } from "../schema";
import type { ProductionBuildRow } from "./buildSchema";
import { failProduction } from "./failure";
import { inventoryProductionTasks } from "./materialSchema";

type BuildTemplate = typeof inventoryTemplates.$inferSelect;

export async function chooseProductionTemplate(
  tx: Db,
  actor: HydratedActor,
  itemId: string,
  signal: AbortSignal,
) {
  if (!(await inventoryProjectsEnabled(tx))) failProduction("project");
  const [template] = await tx
    .select()
    .from(inventoryTemplates)
    .where(eq(inventoryTemplates.itemId, itemId));
  if (template === undefined) failProduction("project");
  const access = await lockInternalProject(tx, actor, template.projectId, "write", "work-items");
  signal.throwIfAborted();
  if (
    !access.ok ||
    access.value.summary.archived ||
    !access.value.canAssign ||
    access.value.guestAccess !== null
  ) {
    failProduction("project");
  }
  return template;
}

export async function applyProductionTemplate(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  template: BuildTemplate,
  signal: AbortSignal,
) {
  const taskIds = await createInventoryProjectTasks(tx, actorId, template, signal, build.id, true);
  await tx.insert(inventoryProductionTasks).values(
    taskIds.map((itemId, position) => ({
      buildId: build.id,
      projectId: template.projectId,
      itemId,
      position,
    })),
  );
}

async function projectTasks(
  tx: Db,
  actor: HydratedActor,
  build: ProductionBuildRow,
  signal: AbortSignal,
) {
  const { id: buildId, projectId } = build;
  if (projectId === null || !(await inventoryProjectsEnabled(tx))) return null;
  const access = await lockInternalProject(tx, actor, projectId, "read", "work-items");
  if (!access.ok || access.value.guestAccess !== null) return null;
  const tasks = await tx
    .select({
      id: internalProjectItems.id,
      title: internalProjectItems.title,
      category: internalProjectStates.category,
      createdBy: internalProjectItems.createdBy,
    })
    .from(inventoryProductionTasks)
    .innerJoin(
      internalProjectItems,
      and(
        eq(internalProjectItems.id, inventoryProductionTasks.itemId),
        eq(internalProjectItems.projectId, inventoryProductionTasks.projectId),
      ),
    )
    .leftJoin(
      internalProjectStates,
      and(
        eq(internalProjectStates.id, internalProjectItems.stateId),
        eq(internalProjectStates.projectId, internalProjectItems.projectId),
      ),
    )
    .where(eq(inventoryProductionTasks.buildId, buildId))
    .orderBy(asc(inventoryProductionTasks.position));
  signal.throwIfAborted();
  const creator = access.value.workItemCreatorId;
  return {
    title: access.value.summary.title,
    tasks,
    visible: creator === null ? tasks : tasks.filter((task) => task.createdBy === creator),
  };
}

export async function readProductionProject(
  tx: Db,
  actor: HydratedActor,
  build: ProductionBuildRow,
  signal: AbortSignal,
) {
  const result = await projectTasks(tx, actor, build, signal);
  if (result === null || build.projectId === null) return null;
  return {
    id: build.projectId,
    title: result.title,
    tasks: result.visible.map(({ id, title, category }) => ({
      id,
      title,
      completed: category === "completed",
    })),
  };
}

export async function requireCompletedProductionTasks(
  tx: Db,
  actor: HydratedActor,
  build: ProductionBuildRow,
  signal: AbortSignal,
) {
  if (build.projectId === null) return;
  const result = await projectTasks(tx, actor, build, signal);
  if (
    result === null ||
    result.visible.length !== result.tasks.length ||
    result.tasks.length === 0 ||
    result.tasks.some(({ category }) => category !== "completed")
  ) {
    failProduction("project");
  }
}
