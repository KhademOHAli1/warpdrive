import { and, asc, desc, eq, exists, isNotNull, isNull, or } from "drizzle-orm";
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
import { readProductionTaskLinks } from "@/features/inventory/production/projectLinks";
import { inventoryBuildReleases } from "@/features/inventory/releases/schema";
import { inventoryOrderTasks } from "@/features/inventory/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import type { ProjectGuestAccess, ProjectResult, ProjectSummary, ProjectWorkspace } from "./contracts";
import {
  currentProjectIntegratorActor,
  isProjectIntegratorPrincipal,
  type ProjectIntegratorPrincipal,
} from "./integrator/principal";
import { internalProjectItems, internalProjectSettings } from "./schema";
import { readProjectWorkflowStates } from "./settings/states";

import { emptyProjectItemStructure } from "./work-structure/contracts";
import {
  readProjectItemStructures,
  readProjectWorkStructure,
} from "./work-structure/itemStructure";

class ProjectSessionExpired extends Error {}

export type InternalProjectPrincipal = NativeSessionRef | ProjectIntegratorPrincipal;

async function currentInternalProjectActor(tx: Db, who: InternalProjectPrincipal, signal: AbortSignal) {
  if (isProjectIntegratorPrincipal(who)) return currentProjectIntegratorActor(tx, who, signal);
  return (await nativeProjectActor(tx, who, signal, "internal"))?.actor ?? null;
}

export async function withInternalProjects<T>(
  db: Db,
  who: InternalProjectPrincipal,
  signal: AbortSignal,
  operation: (tx: Db, actor: HydratedActor) => Promise<ProjectResult<T>>,
): Promise<ProjectResult<T>> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const current = await currentInternalProjectActor(tx, who, signal);
      if (current === null) return err("project_unavailable");
      const result = await operation(tx, current);
      // Roll back writes if the current credential expires during a database wait.
      if ((await currentInternalProjectActor(tx, who, signal)) === null) throw new ProjectSessionExpired();
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
  guest: agencyProjectMembers.projectGuest,
  projectsGuestOnly: users.projectsGuestOnly,
};

export function eligibleStaff(userId: string) {
  return and(eq(users.id, userId), eq(users.isActive, true), isNull(users.invitedAt), eq(users.projectsGuestOnly, false));
}

export function listInternalProjectScope(db: Db, userId: string, guestOnly = false) {
  const member = exists(db.select({ userId: agencyProjectMembers.userId }).from(agencyProjectMembers)
    .where(and(eq(agencyProjectMembers.projectId, agencyProjects.id), eq(agencyProjectMembers.userId, userId),
      guestOnly ? eq(agencyProjectMembers.projectGuest, true) : undefined,
    )));
  return and(eq(agencyProjects.kind, "internal"), guestOnly ? member : or(eq(agencyProjects.ownerUserId, userId), member));
}

function projectGuestAccess(guest: boolean, viewAll: boolean): ProjectGuestAccess | null {
  if (!guest) return null;
  return viewAll ? "all" : "restricted";
}

export async function lockInternalProject(
  db: Db,
  actor: HydratedActor,
  projectId: string,
  mode: "read" | "write",
  surface: "full" | "work-items" | "intake" = "full",
) {
  const [row] = await db
    .select({
      project: agencyProjects,
      identifier: internalProjectSettings.identifier,
      timeZone: internalProjectSettings.timeZone,
      logo: internalProjectSettings.logo,
      cover: internalProjectSettings.cover,
      owner: personFields,
      ownerActive: users.isActive,
      ownerInvitedAt: users.invitedAt,
    })
    .from(agencyProjects)
    .innerJoin(internalProjectSettings, eq(internalProjectSettings.projectId, agencyProjects.id))
    .innerJoin(users, eq(users.id, agencyProjects.ownerUserId))
    .where(and(eq(agencyProjects.id, projectId), listInternalProjectScope(db, actor.id, actor.projectsGuestOnly)))
    .for(mode === "write" ? "update" : "share", { of: agencyProjects });
  if (row === undefined) return err("project_unavailable" as const);
  const { project, identifier, owner, ownerActive, ownerInvitedAt, timeZone, logo, cover } = row;
  const [membership] = await db
    .select({
      projectId: agencyProjectMembers.projectId,
      userId: agencyProjectMembers.userId,
      projectEdit: agencyProjectMembers.projectEdit,
      assignmentCoordinate: agencyProjectMembers.assignmentCoordinate,
      projectGuest: agencyProjectMembers.projectGuest,
      guestViewAllFeatures: internalProjectSettings.guestViewAllFeatures,
    })
    .from(agencyProjectMembers)
    .innerJoin(internalProjectSettings, eq(internalProjectSettings.projectId, agencyProjectMembers.projectId))
    .where(
      and(
        eq(agencyProjectMembers.projectId, project.id),
        eq(agencyProjectMembers.userId, actor.id),
      ),
    );
  const local = { actor, projectId, ownerUserId: owner.id, membership: membership ?? null };
  if (actor.projectsGuestOnly && (membership?.projectGuest !== true || actor.id === owner.id))
    return err("project_unavailable" as const);
  if (!checkProjectLocalAction(local, project, "read").ok)
    return err("project_unavailable" as const);
  const guestAccess = projectGuestAccess(
    membership?.projectGuest === true && actor.id !== owner.id,
    membership?.guestViewAllFeatures === true,
  );
  if (guestAccess === "restricted" && surface === "full") return err("project_unavailable" as const);
  const canEdit = guestAccess === null && checkProjectLocalAction(local, project, "edit-content").ok;
  const canManageSettings = guestAccess === null && checkProjectLocalAction(local, project, "manage-members").ok;
  const summary: ProjectSummary = {
    id: project.id,
    title: project.title,
    identifier,
    timeZone,
    logo,
    cover,
    owner,
    createdAt: project.createdAt.toISOString(),
    archived: project.state === "archived",
  };
  return ok({
    summary,
    guestAccess,
    workItemCreatorId: guestAccess === "restricted" ? actor.id : null,
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
    .where(and(eq(agencyProjectMembers.projectId, access.summary.id), eq(agencyProjectMembers.projectGuest, false), eligibleStaff(userId)));
  return member !== undefined;
}

export async function projectWorkspaceSnapshot(
  db: Db,
  access: InternalProjectAccess,
  includeProductionReleases = false,
  productionActor?: HydratedActor,
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
  const items = await readProjectWorkspaceItems(db, projectId, "active", access.workItemCreatorId);
  const releaseLinks =
    includeProductionReleases && access.guestAccess === null
      ? await db
          .select({ itemId: inventoryOrderTasks.itemId, orderId: inventoryBuildReleases.orderId })
          .from(inventoryOrderTasks)
          .innerJoin(
            inventoryBuildReleases,
            eq(inventoryBuildReleases.orderId, inventoryOrderTasks.orderId),
          )
          .where(eq(inventoryOrderTasks.projectId, projectId))
      : [];
  const orderByTask = new Map(releaseLinks.map(({ itemId, orderId }) => [itemId, orderId]));
  const productionLinks =
    includeProductionReleases && access.guestAccess === null && productionActor !== undefined
      ? await readProductionTaskLinks(db, projectId, productionActor)
      : [];
  const buildByTask = new Map(productionLinks.map(({ itemId, buildId }) => [itemId, buildId]));
  const workStructure = await readProjectWorkStructure(db, projectId);
  const settings = await readInternalProjectSettings(db, projectId);
  const states = await readProjectWorkflowStates(db, projectId);
  const staff = canManageMembers
    ? await db
        .select(personFields)
        .from(users)
        .where(
          and(
            eq(users.isActive, true),
            isNull(users.invitedAt),
            eq(users.projectsGuestOnly, false),
          ),
        )
        .orderBy(asc(users.name), asc(users.id))
    : [];
  return {
    project: summary,
    ...(access.guestAccess === null ? {} : { guestAccess: access.guestAccess }),
    items: items.map((item) => {
      const orderId = orderByTask.get(item.id);
      const buildId = buildByTask.get(item.id);
      return {
        ...item,
        ...(orderId === undefined ? {} : { productionReleaseOrderId: orderId }),
        ...(buildId === undefined ? {} : { productionBuildId: buildId }),
      };
    }),
    workStructure,
    settings,
    states,
    members: memberships
      .filter(({ invitedAt }) => canManageMembers || invitedAt === null)
      .map(({ person, edit, coordinate, guest, invitedAt, projectsGuestOnly }) => ({
        person,
        role: guest ? "guest" : edit ? "editor" : "viewer",
        canAssign: !guest && edit && coordinate,
        ...(guest && invitedAt !== null ? { invitationPending: true as const } : {}),
        ...(projectsGuestOnly ? { projectsGuestOnly: true as const } : {}),
      })),
    assignees: [
      ...(ownerEligible ? [summary.owner] : []),
      ...memberships
        .filter(({ active, invitedAt, guest }) => active && invitedAt === null && !guest)
        .map(({ person }) => person),
    ],
    staff,
    canEdit,
    canAssign,
    canManageMembers,
    canManageSettings,
  };
}

export async function readProjectWorkspaceItems(
  db: Db,
  projectId: string,
  scope: "active" | "archived",
  creatorId: string | null = null,
) {
  const { id, revision, createdAt, updatedAt, archivedAt, createdBy, stateId, sequenceNumber } =
    internalProjectItems;
  const items = await db
    .select({
      id,
      ...projectItemContentFields,
      createdAt,
      updatedAt,
      archivedAt,
      createdBy,
      revision,
      stateId,
      sequenceNumber,
    })
    .from(internalProjectItems)
    .where(
      and(
        eq(internalProjectItems.projectId, projectId),
        creatorId === null ? undefined : eq(createdBy, creatorId),
        scope === "archived" ? isNotNull(archivedAt) : isNull(archivedAt),
      ),
    )
    .orderBy(scope === "archived" ? desc(archivedAt) : asc(createdAt), asc(id));
  const itemStructures = await readProjectItemStructures(db, projectId);
  return items.map((item) => {
    if (item.stateId === null)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Internal work item is missing a workflow state");
    if (item.sequenceNumber === null)
      throw new AppError(
        ERROR_IDS.DB_INVARIANT,
        "Internal work item is missing its sequence number",
      );
    return {
      ...item,
      ...(itemStructures.get(item.id) ?? emptyProjectItemStructure),
      stateId: item.stateId,
      sequenceNumber: item.sequenceNumber,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      archivedAt: item.archivedAt?.toISOString() ?? null,
    };
  });
}

export async function readInternalProjectSettings(db: Db, projectId: string) {
  const { description, revision, leadUserId, defaultAssigneeId, intakeEnabled, timeZone, visibility, guestViewAllFeatures } =
    internalProjectSettings;
  const [settings] = await db
    .select({ description, revision, leadUserId, defaultAssigneeId, intakeEnabled, timeZone, visibility, guestViewAllFeatures })
    .from(internalProjectSettings)
    .where(eq(internalProjectSettings.projectId, projectId));
  if (settings === undefined)
    throw new AppError(
      ERROR_IDS.DB_INVARIANT,
      "Internal project settings are missing a seeded row",
    );
  return settings;
}
