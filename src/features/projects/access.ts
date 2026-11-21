import { and, asc, eq, exists, isNull, or } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
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
import { internalProjectItems, internalProjectSettings } from "./schema";
import { readProjectWorkflowStates } from "./settings/states";

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
      identifier: internalProjectSettings.identifier,
      owner: personFields,
      ownerActive: users.isActive,
      ownerInvitedAt: users.invitedAt,
    })
    .from(agencyProjects)
    .innerJoin(internalProjectSettings, eq(internalProjectSettings.projectId, agencyProjects.id))
    .innerJoin(users, eq(users.id, agencyProjects.ownerUserId))
    .where(and(eq(agencyProjects.id, projectId), listInternalProjectScope(db, actor.id)))
    .for(mode === "write" ? "update" : "share", { of: agencyProjects });
  if (row === undefined) return err("project_unavailable" as const);
  const { project, identifier, owner, ownerActive, ownerInvitedAt } = row;
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
  const canManageSettings = checkProjectLocalAction(local, project, "manage-members").ok;
  const summary: ProjectSummary = {
    id: project.id,
    title: project.title,
    identifier,
    owner,
    createdAt: project.createdAt.toISOString(),
    archived: project.state === "archived",
  };
  return ok({
    summary,
    ownerEligible: ownerActive && ownerInvitedAt === null,
    canEdit,
    canAssign: canEdit && hasProjectAssignmentCoordinateEligibility(local),
    canManageMembers: !summary.archived && canManageSettings,
    canManageSettings,
    lifecycle: {
      state: project.state,
      revision: project.revision,
      archivedFrom: project.archivedFrom,
    },
  });
}

export type InternalProjectAccess = Extract<
  Awaited<ReturnType<typeof lockInternalProject>>,
  { ok: true }
>["value"];

export async function isEligibleProjectMember(
  db: Db,
  access: InternalProjectAccess,
  userId: string,
) {
  if (access.summary.owner.id === userId) return access.ownerEligible;
  const [member] = await db
    .select({ id: users.id })
    .from(agencyProjectMembers)
    .innerJoin(users, eq(users.id, agencyProjectMembers.userId))
    .where(and(eq(agencyProjectMembers.projectId, access.summary.id), eligibleStaff(userId)));
  return member !== undefined;
}

export async function projectWorkspaceSnapshot(
  db: Db,
  access: InternalProjectAccess,
): Promise<ProjectWorkspace> {
  const { summary, ownerEligible, canEdit, canAssign, canManageMembers, canManageSettings } =
    access;
  const projectId = summary.id;
  const memberships = await db
    .select(memberFields)
    .from(agencyProjectMembers)
    .innerJoin(users, eq(users.id, agencyProjectMembers.userId))
    .where(eq(agencyProjectMembers.projectId, projectId))
    .orderBy(asc(users.name), asc(users.id));
  const { id, revision, createdAt, createdBy, stateId, sequenceNumber } = internalProjectItems;
  const items = await db
    .select({ id, ...projectItemContentFields, createdBy, revision, stateId, sequenceNumber })
    .from(internalProjectItems)
    .where(eq(internalProjectItems.projectId, projectId))
    .orderBy(asc(createdAt), asc(id));
  const settings = await readInternalProjectSettings(db, projectId);
  const states = await readProjectWorkflowStates(db, projectId);
  const staff = canManageMembers
    ? await db
        .select(personFields)
        .from(users)
        .where(and(eq(users.isActive, true), isNull(users.invitedAt)))
        .orderBy(asc(users.name), asc(users.id))
    : [];
  return {
    project: summary,
    items: items.map((item) => {
      if (item.stateId === null)
        throw new AppError(
          ERROR_IDS.DB_INVARIANT,
          "Internal work item is missing a workflow state",
        );
      if (item.sequenceNumber === null)
        throw new AppError(
          ERROR_IDS.DB_INVARIANT,
          "Internal work item is missing its sequence number",
        );
      return { ...item, stateId: item.stateId, sequenceNumber: item.sequenceNumber };
    }),
    settings,
    states,
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
    canManageSettings,
  };
}

export async function readInternalProjectSettings(db: Db, projectId: string) {
  const { description, revision, leadUserId, defaultAssigneeId } = internalProjectSettings;
  const [settings] = await db
    .select({ description, revision, leadUserId, defaultAssigneeId })
    .from(internalProjectSettings)
    .where(eq(internalProjectSettings.projectId, projectId));
  if (settings === undefined)
    throw new AppError(
      ERROR_IDS.DB_INVARIANT,
      "Internal project settings are missing a seeded row",
    );
  return settings;
}
