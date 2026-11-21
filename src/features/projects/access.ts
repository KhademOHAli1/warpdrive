import { and, asc, eq, exists, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { nativeProjectActor } from "@/features/agency-projects/nativeAccess";
import {
  checkProjectLocalAction,
  hasProjectAssignmentCoordinateEligibility,
} from "@/features/agency-projects/projectLocalAccess";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import type { ProjectResult, ProjectSummary, ProjectWorkspace } from "./contracts";
import { internalProjectItems } from "./schema";

class ProjectSessionExpired extends Error {}

export async function withInternalProjects<T>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  operation: (tx: Db, actor: HydratedActor) => Promise<ProjectResult<T>>,
): Promise<ProjectResult<T>> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const current = await nativeProjectActor(tx, who, signal);
      if (current === null) return err("project_unavailable");
      const result = await operation(tx, current.actor);
      // Throw to roll back writes if the native credential expires during a database wait.
      if ((await nativeProjectActor(tx, who, signal)) === null) throw new ProjectSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof ProjectSessionExpired) return err("project_unavailable");
    throw error;
  }
}

export const personFields = { id: users.id, name: users.name };
export const projectItemContentFields = {
  title: internalProjectItems.title,
  status: internalProjectItems.status,
  assigneeId: internalProjectItems.assigneeId,
  priority: internalProjectItems.priority,
  startDate: internalProjectItems.startDate,
  dueDate: internalProjectItems.dueDate,
  description: internalProjectItems.description,
};

const memberFields = {
  person: personFields,
  active: users.isActive,
  invitedAt: users.invitedAt,
  edit: agencyProjectMembers.projectEdit,
  coordinate: agencyProjectMembers.assignmentCoordinate,
};

export function eligibleStaff(userId: string) {
  return and(eq(users.id, userId), eq(users.isActive, true), isNull(users.invitedAt));
}

export function listInternalProjectScope(db: Db, userId: string) {
  return and(
    eq(agencyProjects.kind, "internal"),
    or(
      eq(agencyProjects.ownerUserId, userId),
      exists(
        db
          .select({ userId: agencyProjectMembers.userId })
          .from(agencyProjectMembers)
          .where(
            and(
              eq(agencyProjectMembers.projectId, agencyProjects.id),
              eq(agencyProjectMembers.userId, userId),
            ),
          ),
      ),
    ),
  );
}

export async function lockInternalProject(
  db: Db,
  actor: HydratedActor,
  projectId: string,
  mode: "read" | "write",
) {
  const [row] = await db
    .select({
      project: agencyProjects,
      owner: personFields,
      ownerActive: users.isActive,
      ownerInvitedAt: users.invitedAt,
    })
    .from(agencyProjects)
    .innerJoin(users, eq(users.id, agencyProjects.ownerUserId))
    .where(and(eq(agencyProjects.id, projectId), listInternalProjectScope(db, actor.id)))
    .for(mode === "write" ? "update" : "share", { of: agencyProjects });
  if (row === undefined) return err("project_unavailable" as const);
  const { project, owner, ownerActive, ownerInvitedAt } = row;
  const [membership] = await db
    .select()
    .from(agencyProjectMembers)
    .where(
      and(
        eq(agencyProjectMembers.projectId, project.id),
        eq(agencyProjectMembers.userId, actor.id),
      ),
    );
  const local = { actor, projectId, ownerUserId: owner.id, membership: membership ?? null };
  if (!checkProjectLocalAction(local, project, "read").ok)
    return err("project_unavailable" as const);
  const canEdit = checkProjectLocalAction(local, project, "edit-content").ok;
  const summary: ProjectSummary = {
    id: project.id,
    title: project.title,
    owner,
    createdAt: project.createdAt.toISOString(),
  };
  return ok({
    summary,
    ownerEligible: ownerActive && ownerInvitedAt === null,
    canEdit,
    canAssign: canEdit && hasProjectAssignmentCoordinateEligibility(local),
    canManageMembers: checkProjectLocalAction(local, project, "manage-members").ok,
  });
}

export type InternalProjectAccess = Extract<
  Awaited<ReturnType<typeof lockInternalProject>>,
  { ok: true }
>["value"];

export async function projectWorkspaceSnapshot(
  db: Db,
  access: InternalProjectAccess,
): Promise<ProjectWorkspace> {
  const { summary, ownerEligible, canEdit, canAssign, canManageMembers } = access;
  const projectId = summary.id;
  const memberships = await db
    .select(memberFields)
    .from(agencyProjectMembers)
    .innerJoin(users, eq(users.id, agencyProjectMembers.userId))
    .where(eq(agencyProjectMembers.projectId, projectId))
    .orderBy(asc(users.name), asc(users.id));
  const { id, revision, createdAt, createdBy } = internalProjectItems;
  const items = await db
    .select({ id, ...projectItemContentFields, createdBy, revision })
    .from(internalProjectItems)
    .where(eq(internalProjectItems.projectId, projectId))
    .orderBy(asc(createdAt), asc(id));
  const staff = canManageMembers
    ? await db
        .select(personFields)
        .from(users)
        .where(and(eq(users.isActive, true), isNull(users.invitedAt)))
        .orderBy(asc(users.name), asc(users.id))
    : [];
  return {
    project: summary,
    items,
    members: memberships.map(({ person, edit, coordinate }) => ({
      person,
      role: edit ? "editor" : "viewer",
      canAssign: edit && coordinate,
    })),
    assignees: [
      ...(ownerEligible ? [summary.owner] : []),
      ...memberships
        .filter(({ active, invitedAt }) => active && invitedAt === null)
        .map(({ person }) => person),
    ],
    staff,
    canEdit,
    canAssign,
    canManageMembers,
  };
}
