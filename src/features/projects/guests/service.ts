import { and, asc, eq, ne, notExists } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { can } from "@/features/permissions/can";
import { err, ok } from "@/types/result";
import { lockInternalProject, withInternalProjects } from "../access";
import type { DiscoverableProject } from "../contracts";
import { internalProjectSettings as settings } from "../schema";
import type { SaveProjectGuestAccess } from "./contracts";

export async function discoverInternalProjects(
  db: Db,
  actorId: string,
): Promise<DiscoverableProject[]> {
  return db
    .select({ id: agencyProjects.id, title: agencyProjects.title, identifier: settings.identifier })
    .from(agencyProjects)
    .innerJoin(settings, eq(settings.projectId, agencyProjects.id))
    .where(
      and(
        eq(agencyProjects.kind, "internal"),
        eq(settings.visibility, "workspace"),
        ne(agencyProjects.state, "archived"),
        ne(agencyProjects.ownerUserId, actorId),
        notExists(
          db
            .select({ userId: agencyProjectMembers.userId })
            .from(agencyProjectMembers)
            .where(
              and(
                eq(agencyProjectMembers.projectId, agencyProjects.id),
                eq(agencyProjectMembers.userId, actorId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(agencyProjects.title), asc(agencyProjects.id));
}

export function joinPublicInternalProject(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withInternalProjects(db, who, signal, async (tx, actor) => {
    if (actor.projectsGuestOnly) return err("project_forbidden");
    const [target] = await tx
      .select({ id: agencyProjects.id, ownerId: agencyProjects.ownerUserId })
      .from(agencyProjects)
      .where(
        and(
          eq(agencyProjects.id, projectId),
          eq(agencyProjects.kind, "internal"),
          ne(agencyProjects.state, "archived"),
        ),
      )
      .for("update");
    if (target === undefined) return err("project_unavailable");
    // Re-read visibility after locking the project so a concurrent privacy change wins.
    const [visibility] = await tx
      .select({ value: settings.visibility })
      .from(settings)
      .where(eq(settings.projectId, projectId));
    if (visibility?.value !== "workspace") return err("project_unavailable");
    if (target.ownerId !== actor.id) {
      // People already trusted to create projects join as Editors. Other accounts join as Viewers.
      await tx
        .insert(agencyProjectMembers)
        .values({ projectId, userId: actor.id, projectEdit: can(actor, "project.create") })
        .onConflictDoNothing();
    }
    return ok({ projectId });
  });
}

export function saveProjectGuestAccess(
  db: Db,
  who: NativeSessionRef,
  input: SaveProjectGuestAccess,
  signal: AbortSignal,
) {
  const { projectId, revision, visibility, guestViewAllFeatures } = input;
  return withInternalProjects(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "write");
    if (!access.ok) return access;
    if (!access.value.canManageSettings || access.value.summary.archived)
      return err("project_forbidden");
    if (revision === Number.MAX_SAFE_INTEGER) return err("project_conflict");
    const [saved] = await tx
      .update(settings)
      .set({ visibility, guestViewAllFeatures, revision: revision + 1 })
      .where(and(eq(settings.projectId, projectId), eq(settings.revision, revision)))
      .returning({
        visibility: settings.visibility,
        guestViewAllFeatures: settings.guestViewAllFeatures,
        revision: settings.revision,
      });
    return saved === undefined ? err("project_conflict") : ok(saved);
  });
}
