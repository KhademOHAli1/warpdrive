import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { type InternalProjectAccess, readInternalProjectSettings } from "../access";
import { withPlanningProject } from "./access";
import {
  type DeletePlanningView,
  defaultPlanningViewDisplay,
  type PlanningSavedView,
  type PlanningViewDisplay,
  type PlanningViewFilters,
  planningViewDisplayInput,
  type SavePlanningView,
  type SetPlanningViewArchive,
  type SetPlanningViewFavorite,
  type SetPlanningViewLock,
} from "./contracts";
import {
  internalProjectSavedViewFavorites as favorites,
  internalProjectPlanningGroups as groups,
  internalProjectSavedViews as views,
} from "./schema";

type ViewRow = typeof views.$inferSelect;
type ViewKey = Pick<SavePlanningView, "projectId" | "viewId">;
type ViewAccess = Pick<InternalProjectAccess, "canEdit" | "canManageSettings" | "summary">;

function viewResult(
  row: ViewRow & { favorite?: boolean },
  access: ViewAccess,
  actorId: string,
): PlanningSavedView {
  const isAuthor = row.ownerId === actorId;
  const canManage = access.canEdit && (isAuthor || access.canManageSettings);
  const { id, title, description, revision, layout, filters, visibility, archivedAt } = row;
  return {
    id,
    title,
    description,
    revision,
    layout,
    filters,
    display: planningViewDisplayInput.parse(row.display),
    locked: row.locked,
    favorite: row.favorite ?? false,
    canFavorite: !access.summary.archived && archivedAt === null,
    visibility,
    archived: archivedAt !== null,
    canEdit: access.canEdit && isAuthor,
    canArchive: canManage,
    canDelete: canManage,
  };
}

export function deletePlanningView(
  db: Db,
  session: NativeSessionRef,
  input: DeletePlanningView,
  signal: AbortSignal,
) {
  const { projectId, viewId, revision } = input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx, access, actor) => {
    const current = await findView(tx, input, actor.id);
    if (current === undefined) return err("project_unavailable");
    if (!viewResult(current, access, actor.id).canDelete) return err("project_forbidden");
    if (current.revision !== revision) return err("project_conflict");
    const [deleted] = await tx
      .delete(views)
      .where(
        and(visibleViews(projectId, actor.id), eq(views.id, viewId), eq(views.revision, revision)),
      )
      .returning({ viewId: views.id });
    return deleted === undefined ? err("project_conflict") : ok(deleted);
  });
}

function viewsWithFavorites(tx: Db, userId: string) {
  return tx
    .select({ view: views, favoriteViewId: favorites.viewId })
    .from(views)
    .leftJoin(favorites, and(eq(favorites.viewId, views.id), eq(favorites.userId, userId)));
}

function visibleViews(projectId: string, userId: string) {
  return and(
    eq(views.projectId, projectId),
    or(eq(views.visibility, "project"), eq(views.ownerId, userId)),
  );
}

async function findView(tx: Db, { projectId, viewId }: ViewKey, userId: string) {
  const [match] = await viewsWithFavorites(tx, userId).where(
    and(visibleViews(projectId, userId), eq(views.id, viewId)),
  );
  return match === undefined
    ? undefined
    : { ...match.view, favorite: match.favoriteViewId !== null };
}

export function listPlanningViews(
  db: Db,
  session: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withPlanningProject(db, session, projectId, "read", signal, async (tx, access, actor) => {
    const { summary, canEdit, canManageSettings } = access;
    const rows = await viewsWithFavorites(tx, actor.id)
      .where(visibleViews(projectId, actor.id))
      .orderBy(sql`${favorites.viewId} IS NULL`, asc(views.title), asc(views.id));
    return ok({
      project: summary,
      intakeEnabled: (await readInternalProjectSettings(tx, projectId)).intakeEnabled,
      canEdit,
      canManageSettings,
      views: rows.map(({ view, favoriteViewId }) =>
        viewResult({ ...view, favorite: favoriteViewId !== null }, access, actor.id),
      ),
    });
  });
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
  const display = input.display ?? defaultPlanningViewDisplay;
  const existingDisplay = planningViewDisplayInput.parse(row.display);
  return (
    row.ownerId === input.expectedActorId &&
    row.title === input.title &&
    row.description === input.description &&
    row.layout === input.layout &&
    row.visibility === input.visibility &&
    Object.keys(display).every(
      (key) =>
        existingDisplay[key as keyof PlanningViewDisplay] ===
        display[key as keyof PlanningViewDisplay],
    ) &&
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
  const { projectId, viewId, revision, title, description, layout, visibility, filters, display } =
    input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx, access, actor) => {
    if (!(await validViewGroups(tx, projectId, filters))) return err("project_invalid");
    const content = { title, description, layout, visibility, filters, display };
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
    if (current.ownerId !== actor.id || current.locked) return err("project_forbidden");
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
    return updated
      ? ok(viewResult({ ...updated, favorite: current.favorite }, access, actor.id))
      : err("project_conflict");
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
    return updated
      ? ok(viewResult({ ...updated, favorite: current.favorite }, access, actor.id))
      : err("project_unavailable");
  });
}

export function setPlanningViewLock(
  db: Db,
  session: NativeSessionRef,
  input: SetPlanningViewLock,
  signal: AbortSignal,
) {
  const { projectId, viewId, revision, locked } = input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx, access, actor) => {
    const current = await findView(tx, input, actor.id);
    if (current === undefined) return err("project_unavailable");
    if (current.ownerId !== actor.id || current.archivedAt !== null)
      return err("project_forbidden");
    if (current.locked === locked) return ok(viewResult(current, access, actor.id));
    if (current.revision !== revision) return err("project_conflict");
    const [updated] = await tx
      .update(views)
      .set({ locked, revision: revision + 1 })
      .where(and(eq(views.projectId, projectId), eq(views.id, viewId)))
      .returning();
    return updated
      ? ok(viewResult({ ...updated, favorite: current.favorite }, access, actor.id))
      : err("project_unavailable");
  });
}

export function setPlanningViewFavorite(
  db: Db,
  session: NativeSessionRef,
  input: SetPlanningViewFavorite,
  signal: AbortSignal,
) {
  return withPlanningProject(
    db,
    session,
    input.projectId,
    "read",
    signal,
    async (tx, access, actor) => {
      const current = await findView(tx, input, actor.id);
      if (current === undefined) return err("project_unavailable");
      if (access.summary.archived || (input.favorite && current.archivedAt !== null))
        return err("project_forbidden");
      if (input.favorite) {
        await tx
          .insert(favorites)
          .values({ userId: actor.id, viewId: current.id })
          .onConflictDoNothing();
      } else {
        await tx
          .delete(favorites)
          .where(and(eq(favorites.userId, actor.id), eq(favorites.viewId, current.id)));
      }
      return ok(viewResult({ ...current, favorite: input.favorite }, access, actor.id));
    },
  );
}
