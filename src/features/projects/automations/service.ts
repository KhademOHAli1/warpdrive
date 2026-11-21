import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { lockInternalProject, readProjectWorkspaceItems, withInternalProjects } from "../access";
import type { ProjectItem, ProjectResult } from "../contracts";
import { recordProjectItemEvent } from "../profile/events";
import { internalProjectItems, internalProjectStates } from "../schema";
import {
  type ArchiveProjectItem,
  defaultProjectAutomationSettings,
  type ProjectAutomationSettings,
  type SaveProjectAutomation,
} from "./contracts";
import {
  internalProjectAutomationEvents as events,
  internalProjectAutomations as rules,
} from "./schema";

const ruleFields = {
  archiveAfterMonths: rules.archiveAfterMonths,
  closeAfterMonths: rules.closeAfterMonths,
  closeStateId: rules.closeStateId,
  revision: rules.revision,
};

export async function readProjectAutomationSettings(
  db: Db,
  projectId: string,
): Promise<ProjectAutomationSettings> {
  const [value] = await db.select(ruleFields).from(rules).where(eq(rules.projectId, projectId));
  return value ?? defaultProjectAutomationSettings;
}

export function readProjectAutomation(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withInternalProjects(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "read");
    if (!access.ok) return access;
    if (!access.value.canManageSettings) return err("project_forbidden");
    const settings = await readProjectAutomationSettings(tx, projectId);
    const recent = await tx
      .select({
        id: events.id,
        itemId: events.itemId,
        sequenceNumber: internalProjectItems.sequenceNumber,
        itemArchivedAt: internalProjectItems.archivedAt,
        title: internalProjectItems.title,
        kind: events.kind,
        recordedAt: events.recordedAt,
      })
      .from(events)
      .innerJoin(internalProjectItems, eq(events.itemId, internalProjectItems.id))
      .where(eq(events.projectId, projectId))
      .orderBy(desc(events.recordedAt), desc(events.id))
      .limit(12);
    return ok({ settings, recent });
  });
}

export function saveProjectAutomation(
  db: Db,
  who: NativeSessionRef,
  input: SaveProjectAutomation,
  signal: AbortSignal,
): Promise<ProjectResult<ProjectAutomationSettings>> {
  return withInternalProjects(db, who, signal, async (tx, actor) => {
    const { projectId, revision, archiveAfterMonths, closeAfterMonths, closeStateId } = input;
    const access = await lockInternalProject(tx, actor, projectId, "write");
    if (!access.ok) return access;
    if (!access.value.canManageSettings || !access.value.canEdit) return err("project_forbidden");
    const current = await readProjectAutomationSettings(tx, projectId);
    if (current.revision !== revision || revision === Number.MAX_SAFE_INTEGER)
      return err("project_conflict");
    if (closeStateId !== null) {
      const [target] = await tx
        .select({ id: internalProjectStates.id })
        .from(internalProjectStates)
        .where(
          and(
            eq(internalProjectStates.projectId, projectId),
            eq(internalProjectStates.id, closeStateId),
            eq(internalProjectStates.category, "cancelled"),
          ),
        );
      if (target === undefined) return err("project_invalid");
    }
    if (
      current.archiveAfterMonths === archiveAfterMonths &&
      current.closeAfterMonths === closeAfterMonths &&
      current.closeStateId === closeStateId
    )
      return ok(current);
    const next = { archiveAfterMonths, closeAfterMonths, closeStateId, revision: revision + 1 };
    await tx
      .insert(rules)
      .values({ projectId, ...next })
      .onConflictDoUpdate({
        target: rules.projectId,
        set: next,
      });
    return ok(next);
  });
}

export function readArchivedProjectItems(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectItem[]>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "read");
    if (!access.ok) return access;
    return ok(await readProjectWorkspaceItems(tx, projectId, "archived"));
  });
}

export function isProjectItemArchived(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  itemId: string,
  signal: AbortSignal,
) {
  return withInternalProjects<boolean>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "read");
    if (!access.ok) return access;
    const item = internalProjectItems;
    const [record] = await tx
      .select({ id: item.id })
      .from(item)
      .where(and(eq(item.projectId, projectId), eq(item.id, itemId), isNotNull(item.archivedAt)));
    return ok(record !== undefined);
  });
}

export function archiveProjectItem(
  db: Db,
  who: NativeSessionRef,
  { projectId, itemId, revision, archived }: ArchiveProjectItem,
  signal: AbortSignal,
): Promise<ProjectResult<true>> {
  return withInternalProjects(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "write");
    if (!access.ok) return access;
    if (!access.value.canEdit) return err("project_forbidden");
    const item = internalProjectItems;
    const state = internalProjectStates;
    const target = and(eq(item.id, itemId), eq(item.projectId, projectId));
    const [current] = await tx
      .select({ revision: item.revision, archivedAt: item.archivedAt, category: state.category })
      .from(item)
      .innerJoin(state, and(eq(item.projectId, state.projectId), eq(item.stateId, state.id)))
      .where(target);
    if (current === undefined) return err("project_unavailable");
    if (current.revision !== revision || revision === Number.MAX_SAFE_INTEGER)
      return err("project_conflict");
    if ((current.archivedAt !== null) === archived) return ok(true);
    if (archived && current.category !== "completed" && current.category !== "cancelled")
      return err("project_invalid");
    await tx
      .update(item)
      .set({
        archivedAt: archived ? sql`statement_timestamp()` : null,
        updatedAt: sql`statement_timestamp()`,
        revision: revision + 1,
      })
      .where(
        and(
          target,
          eq(item.revision, revision),
          archived ? isNull(item.archivedAt) : isNotNull(item.archivedAt),
        ),
      );
    await recordProjectItemEvent(tx, { itemId, actorId: actor.id, kind: "updated" });
    return ok(true);
  });
}
