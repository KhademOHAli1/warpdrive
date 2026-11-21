import { and, asc, count, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { err, ok } from "@/types/result";
import { type InternalProjectPrincipal, readInternalProjectSettings } from "../access";
import { internalProjectItems as items } from "../schema";
import { projectToday } from "../settings/projectTime";
import { withPlanningProject } from "./access";
import {
  canArchivePlanningGroup,
  type PlanningGroup,
  type PlanningGroupKind,
  type PlanningReadHeader,
  planningCyclePhase,
  type SavePlanningGroup,
  type SetPlanningGroupArchive,
} from "./contracts";
import {
  internalProjectPlanningAssignments as assignments,
  internalProjectPlanningGroups as groups,
} from "./schema";

type GroupRow = typeof groups.$inferSelect;
type GroupTarget = Pick<SavePlanningGroup, "projectId" | "groupId" | "kind">;
type GroupDetail = PlanningReadHeader & {
  group: PlanningGroup;
  items: { id: string; title: string; included: boolean }[];
};

function groupResult(row: GroupRow, itemCount = 0, closedCount = 0): PlanningGroup {
  const { id, title, description, kind, revision, startDate, endDate, moduleStatus, archivedAt } =
    row;
  return {
    id,
    title,
    description,
    kind,
    revision,
    startDate,
    endDate,
    moduleStatus,
    archived: archivedAt !== null,
    itemCount,
    closedCount,
    rolloverSnapshot: row.rolloverSnapshot,
  };
}

function groupKey({ projectId, groupId, kind }: GroupTarget) {
  return and(eq(groups.projectId, projectId), eq(groups.id, groupId), eq(groups.kind, kind));
}

export function listPlanningGroups(
  db: Db,
  session: InternalProjectPrincipal,
  projectId: string,
  kind: PlanningGroupKind,
  signal: AbortSignal,
) {
  return withPlanningProject(
    db,
    session,
    projectId,
    "read",
    signal,
    async (tx, { summary, canEdit, canManageSettings }) => {
      const rows = await tx
        .select({
          group: groups,
          total: count(items.id),
          closed: count(sql`CASE WHEN ${items.status} = 'done' THEN ${items.id} END`),
        })
        .from(groups)
        .leftJoin(assignments, eq(assignments.groupId, groups.id))
        .leftJoin(
          items,
          and(
            eq(items.id, assignments.itemId),
            eq(items.projectId, projectId),
            isNull(items.archivedAt),
          ),
        )
        .where(and(eq(groups.projectId, projectId), eq(groups.kind, kind)))
        .groupBy(groups.id)
        .orderBy(asc(groups.startDate), asc(groups.title), asc(groups.id));
      return ok({
        project: summary,
        intakeEnabled: (await readInternalProjectSettings(tx, projectId)).intakeEnabled,
        canEdit,
        canManageSettings,
        groups: rows.map(({ group, total, closed }) => groupResult(group, total, closed)),
      });
    },
  );
}

export function readPlanningGroup(
  db: Db,
  session: InternalProjectPrincipal,
  input: GroupTarget,
  signal: AbortSignal,
) {
  return withPlanningProject<GroupDetail>(
    db,
    session,
    input.projectId,
    "read",
    signal,
    async (tx, { summary, canEdit, canManageSettings }) => {
      const [group] = await tx.select().from(groups).where(groupKey(input));
      if (group === undefined) return err("project_unavailable");
      const closedCycle =
        group.kind === "cycles" &&
        planningCyclePhase(group, projectToday(summary.timeZone)) === "completed";
      const rows = await tx
        .select({
          id: items.id,
          title: items.title,
          status: items.status,
          included: sql<boolean>`${assignments.itemId} IS NOT NULL`,
        })
        .from(items)
        .leftJoin(
          assignments,
          and(eq(assignments.itemId, items.id), eq(assignments.groupId, group.id)),
        )
        .where(
          and(
            eq(items.projectId, input.projectId),
            isNull(items.archivedAt),
            group.archivedAt !== null || closedCycle || !canEdit
              ? sql`${assignments.itemId} IS NOT NULL`
              : undefined,
          ),
        )
        .orderBy(asc(items.title), asc(items.id));
      const included = rows.filter((item) => item.included);
      return ok({
        project: summary,
        intakeEnabled: (await readInternalProjectSettings(tx, input.projectId)).intakeEnabled,
        canEdit,
        canManageSettings,
        group: groupResult(
          group,
          included.length,
          included.filter(({ status }) => status === "done").length,
        ),
        items: rows.map(({ id, title, included }) => ({ id, title, included })),
      });
    },
  );
}

async function hasCycleOverlap(
  tx: Db,
  projectId: string,
  groupId: string,
  startDate: string,
  endDate: string,
) {
  const [match] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.projectId, projectId),
        eq(groups.kind, "cycles"),
        ne(groups.id, groupId),
        lte(groups.startDate, endDate),
        gte(groups.endDate, startDate),
      ),
    )
    .limit(1);
  return match !== undefined;
}

async function moduleNameInUse(tx: Db, { projectId, groupId, title }: SavePlanningGroup) {
  const [match] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.projectId, projectId),
        eq(groups.kind, "modules"),
        eq(groups.title, title),
        ne(groups.id, groupId),
      ),
    )
    .limit(1);
  return match !== undefined;
}

function validGroupFields({ kind, startDate, endDate, moduleStatus }: SavePlanningGroup) {
  if (kind === "cycles" && (moduleStatus !== null || (startDate === null) !== (endDate === null)))
    return false;
  if (kind === "modules" && moduleStatus === null) return false;
  return startDate === null || endDate === null || startDate <= endDate;
}

export function savePlanningGroup(
  db: Db,
  session: InternalProjectPrincipal,
  input: SavePlanningGroup,
  signal: AbortSignal,
) {
  const {
    projectId,
    groupId,
    kind,
    startDate,
    endDate,
    moduleStatus,
    title,
    description,
    revision,
  } = input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx, { summary }) => {
    if (!validGroupFields(input)) return err("project_invalid");
    if (kind === "modules" && (await moduleNameInUse(tx, input))) return err("project_conflict");
    if (
      kind === "cycles" &&
      startDate !== null &&
      endDate !== null &&
      (await hasCycleOverlap(tx, projectId, groupId, startDate, endDate))
    )
      return err("project_conflict");
    const content = { title, description, startDate, endDate, moduleStatus };
    if (revision === null) {
      const [created] = await tx
        .insert(groups)
        .values({ ...content, id: groupId, projectId, kind })
        .onConflictDoNothing()
        .returning();
      if (created) return ok(groupResult(created));
      const [existing] = await tx.select().from(groups).where(groupKey(input));
      if (
        existing === undefined ||
        Object.keys(content).some(
          (field) =>
            existing[field as keyof typeof content] !== content[field as keyof typeof content],
        )
      )
        return err("project_conflict");
      return ok(groupResult(existing));
    }
    const [current] = await tx.select().from(groups).where(groupKey(input));
    if (current === undefined) return err("project_unavailable");
    if (
      current.archivedAt !== null ||
      (kind === "cycles" &&
        planningCyclePhase(current, projectToday(summary.timeZone)) === "completed")
    )
      return err("project_forbidden");
    const [updated] = await tx
      .update(groups)
      .set({ ...content, revision: revision + 1 })
      .where(and(groupKey(input), eq(groups.revision, revision), isNull(groups.archivedAt)))
      .returning();
    return updated ? ok(groupResult(updated)) : err("project_conflict");
  });
}

export function setPlanningGroupArchive(
  db: Db,
  session: InternalProjectPrincipal,
  input: SetPlanningGroupArchive,
  signal: AbortSignal,
) {
  const { projectId, groupId, archived, revision } = input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx, { summary }) => {
    const [current] = await tx.select().from(groups).where(groupKey(input));
    if (current === undefined) return err("project_unavailable");
    if ((current.archivedAt !== null) === archived) return ok(groupResult(current));
    if (current.revision !== revision) return err("project_conflict");
    if (archived && !canArchivePlanningGroup(current, projectToday(summary.timeZone)))
      return err("project_invalid");
    if (
      !archived &&
      current.kind === "cycles" &&
      current.startDate !== null &&
      current.endDate !== null &&
      (await hasCycleOverlap(tx, projectId, groupId, current.startDate, current.endDate))
    )
      return err("project_conflict");
    const [updated] = await tx
      .update(groups)
      .set({ archivedAt: archived ? new Date() : null, revision: revision + 1 })
      .where(groupKey(input))
      .returning();
    return updated ? ok(groupResult(updated)) : err("project_unavailable");
  });
}
