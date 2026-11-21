import { and, asc, eq, exists, gte, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { err, ok } from "@/types/result";
import { type InternalProjectPrincipal, readInternalProjectSettings } from "../access";
import { internalProjectItems as items } from "../schema";
import { projectToday } from "../settings/projectTime";
import { withPlanningProject } from "./access";
import {
  type ChangePlanningGroupItems,
  type PlanningAssignment,
  type PlanningGroupKind,
  planningCyclePhase,
  type SetItemPlanning,
  type WorkspacePlanning,
} from "./contracts";
import {
  internalProjectPlanningAssignments as assignments,
  internalProjectPlanningGroups as groups,
} from "./schema";

export async function projectPlanningSnapshot(
  tx: Db,
  projectId: string,
): Promise<WorkspacePlanning> {
  const today = projectToday((await readInternalProjectSettings(tx, projectId)).timeZone);
  const entries = await tx
    .select({
      id: groups.id,
      title: groups.title,
      kind: groups.kind,
      archivedAt: groups.archivedAt,
      startDate: groups.startDate,
      endDate: groups.endDate,
    })
    .from(groups)
    .where(eq(groups.projectId, projectId))
    .orderBy(asc(groups.title), asc(groups.id));
  const relations = await tx
    .select()
    .from(assignments)
    .innerJoin(groups, eq(assignments.groupId, groups.id))
    .innerJoin(items, eq(assignments.itemId, items.id))
    .where(
      and(
        eq(groups.projectId, projectId),
        eq(items.projectId, projectId),
        isNull(items.archivedAt),
      ),
    )
    .orderBy(asc(assignments.itemId), asc(groups.title), asc(groups.id));
  const mapping = new Map<string, PlanningAssignment>();
  for (const { internal_project_planning_assignments: relation } of relations) {
    const assignment = mapping.get(relation.itemId) ?? {
      itemId: relation.itemId,
      cycleId: null,
      moduleIds: [],
    };
    if (relation.kind === "cycles") assignment.cycleId = relation.groupId;
    else assignment.moduleIds.push(relation.groupId);
    mapping.set(relation.itemId, assignment);
  }
  const choices = (kind: PlanningGroupKind) =>
    entries
      .filter((entry) => entry.kind === kind)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        archived: entry.archivedAt !== null,
        acceptsWork:
          entry.archivedAt === null &&
          (kind !== "cycles" || planningCyclePhase(entry, today) !== "completed"),
      }));
  return {
    cycles: choices("cycles"),
    modules: choices("modules"),
    assignments: [...mapping.values()],
  };
}

export function readWorkspacePlanning(
  db: Db,
  session: InternalProjectPrincipal,
  projectId: string,
  signal: AbortSignal,
) {
  return withPlanningProject(db, session, projectId, "read", signal, async (tx) =>
    ok(await projectPlanningSnapshot(tx, projectId)),
  );
}

async function itemInProject(tx: Db, projectId: string, itemId: string) {
  const [row] = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.projectId, projectId), eq(items.id, itemId), isNull(items.archivedAt)));
  return row !== undefined;
}

async function activeGroupsInProject(
  tx: Db,
  projectId: string,
  kind: PlanningGroupKind,
  groupIds: string[],
  retainedItemId?: string,
  adding = true,
) {
  if (groupIds.length === 0) return true;
  const openDates =
    adding && kind === "cycles"
      ? or(
          isNull(groups.endDate),
          gte(
            groups.endDate,
            projectToday((await readInternalProjectSettings(tx, projectId)).timeZone),
          ),
        )
      : undefined;
  const active = and(isNull(groups.archivedAt), openDates);
  const available =
    retainedItemId === undefined
      ? active
      : or(
          active,
          exists(
            tx
              .select({ itemId: assignments.itemId })
              .from(assignments)
              .where(
                and(
                  eq(assignments.projectId, projectId),
                  eq(assignments.groupId, groups.id),
                  eq(assignments.itemId, retainedItemId),
                ),
              ),
          ),
        );
  const rows = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.projectId, projectId),
        eq(groups.kind, kind),
        available,
        inArray(groups.id, groupIds),
      ),
    );
  return rows.length === groupIds.length;
}

async function replaceAssignments(
  tx: Db,
  projectId: string,
  itemId: string,
  kind: PlanningGroupKind,
  ids: string[],
) {
  await tx
    .delete(assignments)
    .where(
      and(
        eq(assignments.projectId, projectId),
        eq(assignments.itemId, itemId),
        eq(assignments.kind, kind),
      ),
    );
  if (ids.length > 0)
    await tx
      .insert(assignments)
      .values(ids.map((groupId) => ({ groupId, projectId, itemId, kind })));
}

type NewItemPlanning = { cycleId?: string | undefined; moduleId?: string | undefined };

// The caller already holds the project write lock and uses the same transaction for the item.
export async function validateNewItemPlanning(
  tx: Db,
  projectId: string,
  planning: NewItemPlanning,
) {
  const { cycleId, moduleId } = planning;
  return (
    (cycleId === undefined || (await activeGroupsInProject(tx, projectId, "cycles", [cycleId]))) &&
    (moduleId === undefined || (await activeGroupsInProject(tx, projectId, "modules", [moduleId])))
  );
}

export async function attachNewItemPlanning(
  tx: Db,
  projectId: string,
  itemId: string,
  { cycleId, moduleId }: NewItemPlanning,
) {
  const rows: (typeof assignments.$inferInsert)[] = [];
  if (cycleId !== undefined) rows.push({ projectId, itemId, groupId: cycleId, kind: "cycles" });
  if (moduleId !== undefined) rows.push({ projectId, itemId, groupId: moduleId, kind: "modules" });
  if (rows.length > 0) await tx.insert(assignments).values(rows);
}

export function setItemPlanning(
  db: Db,
  session: InternalProjectPrincipal,
  input: SetItemPlanning,
  signal: AbortSignal,
) {
  const { projectId, itemId, cycleId } = input;
  const moduleIds = input.moduleIds === undefined ? undefined : [...new Set(input.moduleIds)];
  return withPlanningProject(db, session, projectId, "write", signal, async (tx) => {
    if (!(await itemInProject(tx, projectId, itemId))) return err("project_unavailable");
    if (
      cycleId != null &&
      !(await activeGroupsInProject(tx, projectId, "cycles", [cycleId], itemId))
    )
      return err("project_invalid");
    if (
      moduleIds !== undefined &&
      !(await activeGroupsInProject(tx, projectId, "modules", moduleIds, itemId))
    )
      return err("project_invalid");
    if (cycleId !== undefined)
      await replaceAssignments(tx, projectId, itemId, "cycles", cycleId === null ? [] : [cycleId]);
    if (moduleIds !== undefined)
      await replaceAssignments(tx, projectId, itemId, "modules", moduleIds);
    return ok(await projectPlanningSnapshot(tx, projectId));
  });
}

export function changePlanningGroupItems(
  db: Db,
  session: InternalProjectPrincipal,
  input: ChangePlanningGroupItems,
  signal: AbortSignal,
) {
  const { projectId, groupId, itemId, kind, included } = input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx) => {
    if (!(await itemInProject(tx, projectId, itemId))) return err("project_unavailable");
    if (!(await activeGroupsInProject(tx, projectId, kind, [groupId], undefined, included)))
      return err("project_unavailable");
    if (!included) {
      await tx
        .delete(assignments)
        .where(
          and(
            eq(assignments.groupId, groupId),
            eq(assignments.projectId, projectId),
            eq(assignments.itemId, itemId),
          ),
        );
    } else if (kind === "cycles") {
      await replaceAssignments(tx, projectId, itemId, kind, [groupId]);
    } else {
      await tx
        .insert(assignments)
        .values({ groupId, projectId, itemId, kind })
        .onConflictDoNothing();
    }
    return ok({ itemId });
  });
}
