import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import type { InternalProjectAccess } from "../access";
import { withPlanningProject } from "./access";
import type {
  PlanningSavedView,
  PlanningViewFilters,
  SavePlanningView,
  SetPlanningViewArchive,
} from "./contracts";
import {
  internalProjectPlanningGroups as groups,
  internalProjectSavedViews as views,
} from "./schema";

type ViewRow = typeof views.$inferSelect;
type ViewKey = Pick<SavePlanningView, "projectId" | "viewId">;

function viewResult(
  row: ViewRow,
  access: Pick<InternalProjectAccess, "canEdit" | "canManageSettings">,
  actorId: string,
): PlanningSavedView {
  const isAuthor = row.ownerId === actorId;
  const { id, title, description, revision, layout, filters, visibility, archivedAt } = row;
  return {
    id,
    title,
    description,
    revision,
    layout,
    filters,
    visibility,
    archived: archivedAt !== null,
    canEdit: access.canEdit && isAuthor,
    canArchive: access.canEdit && (isAuthor || access.canManageSettings),
  };
}

function visibleViews(projectId: string, userId: string) {
  return and(
    eq(views.projectId, projectId),
    or(eq(views.visibility, "project"), eq(views.ownerId, userId)),
  );
}

async function findView(tx: Db, { projectId, viewId }: ViewKey, userId: string) {
  const [match] = await tx
    .select()
    .from(views)
    .where(and(visibleViews(projectId, userId), eq(views.id, viewId)));
  return match;
}

export function listPlanningViews(
  db: Db,
  session: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withPlanningProject(
    db,
    session,
    projectId,
    "read",
    signal,
    async (tx, { summary, canEdit, canManageSettings }, actor) => {
      const rows = await tx
        .select()
        .from(views)
        .where(visibleViews(projectId, actor.id))
        .orderBy(asc(views.title), asc(views.id));
      return ok({
        project: summary,
        canEdit,
        canManageSettings,
        views: rows.map((row) => viewResult(row, { canEdit, canManageSettings }, actor.id)),
      });
    },
  );
}

export function readPlanningView(
  db: Db,
  session: NativeSessionRef,
  input: ViewKey,
  signal: AbortSignal,
) {
  return withPlanningProject(
    db,
    session,
    input.projectId,
    "read",
    signal,
    async (tx, access, actor) => {
      const row = await findView(tx, input, actor.id);
      return row === undefined ? err("project_unavailable") : ok(viewResult(row, access, actor.id));
    },
  );
}

async function validViewGroups(
  tx: Db,
  projectId: string,
  { cycleId, moduleId }: PlanningViewFilters,
) {
  const ids = [cycleId, moduleId].filter(Boolean);
  if (ids.length === 0) return true;
  const records = await tx
    .select({ id: groups.id, kind: groups.kind })
    .from(groups)
    .where(and(eq(groups.projectId, projectId), inArray(groups.id, ids)));
  return (
    (cycleId === "" || records.some(({ id, kind }) => id === cycleId && kind === "cycles")) &&
    (moduleId === "" || records.some(({ id, kind }) => id === moduleId && kind === "modules"))
  );
}

function sameView(row: ViewRow, input: SavePlanningView) {
  return (
    row.ownerId === input.expectedActorId &&
    row.title === input.title &&
    row.description === input.description &&
    row.layout === input.layout &&
    row.visibility === input.visibility &&
    Object.keys(input.filters).every(
      (key) =>
        row.filters[key as keyof PlanningViewFilters] ===
        input.filters[key as keyof PlanningViewFilters],
    )
  );
}

export function savePlanningView(
  db: Db,
  session: NativeSessionRef,
  input: SavePlanningView,
  signal: AbortSignal,
) {
  const { projectId, viewId, revision, title, description, layout, visibility, filters } = input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx, access, actor) => {
    if (!(await validViewGroups(tx, projectId, filters))) return err("project_invalid");
    const content = { title, description, layout, visibility, filters };
    if (revision === null) {
      const [created] = await tx
        .insert(views)
        .values({ ...content, id: viewId, projectId, ownerId: actor.id })
        .onConflictDoNothing()
        .returning();
      if (created) return ok(viewResult(created, access, actor.id));
      const existing = await findView(tx, input, actor.id);
      return existing && sameView(existing, input)
        ? ok(viewResult(existing, access, actor.id))
        : err("project_conflict");
    }
    const current = await findView(tx, input, actor.id);
    if (current === undefined) return err("project_unavailable");
    if (current.ownerId !== actor.id) return err("project_forbidden");
    const [updated] = await tx
      .update(views)
      .set({ ...content, revision: revision + 1 })
      .where(
        and(
          visibleViews(projectId, actor.id),
          eq(views.id, viewId),
          eq(views.revision, revision),
          isNull(views.archivedAt),
        ),
      )
      .returning();
    return updated ? ok(viewResult(updated, access, actor.id)) : err("project_conflict");
  });
}

export function setPlanningViewArchive(
  db: Db,
  session: NativeSessionRef,
  input: SetPlanningViewArchive,
  signal: AbortSignal,
) {
  const { projectId, viewId, archived, revision } = input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx, access, actor) => {
    const current = await findView(tx, input, actor.id);
    if (current === undefined) return err("project_unavailable");
    if (!viewResult(current, access, actor.id).canArchive) return err("project_forbidden");
    if ((current.archivedAt !== null) === archived)
      return ok(viewResult(current, access, actor.id));
    if (current.revision !== revision) return err("project_conflict");
    const [updated] = await tx
      .update(views)
      .set({ archivedAt: archived ? new Date() : null, revision: revision + 1 })
      .where(and(visibleViews(projectId, actor.id), eq(views.id, viewId)))
      .returning();
    return updated ? ok(viewResult(updated, access, actor.id)) : err("project_unavailable");
  });
}
