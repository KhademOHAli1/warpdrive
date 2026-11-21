import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { appendProjectHistory } from "@/features/agency-projects/persistence/projectRepositoryHistory";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { can } from "@/features/permissions/can";
import { err, ok } from "@/types/result";
import {
  eligibleStaff,
  type InternalProjectAccess,
  listInternalProjectScope,
  lockInternalProject,
  personFields,
  projectItemContentFields,
  projectWorkspaceSnapshot,
  withInternalProjects,
} from "./access";
import type {
  CreateProjectInput,
  CreateProjectItemInput,
  ProjectIndex,
  ProjectResult,
  ProjectSummary,
  ProjectWorkspace,
  SetProjectMemberInput,
  UpdateProjectItemInput,
} from "./contracts";
import {
  initialProjectItemContent,
  matchesInitialProjectItemContent,
  validProjectItemDates,
} from "./input";
import { recordProjectItemEvent } from "./profile/events";
import { internalProjectItems } from "./schema";

// Derive a stable UUID for an intent within its actor and record scope. The client
// supplies an intent ID and cannot address another actor's row through creation.
function intentRecordId(scope: string, actorId: string, intentId: string): string {
  const bytes = createHash("sha256")
    .update(`warpdrive-internal-projects/${scope}/${actorId}/${intentId}`)
    .digest();
  bytes[6] = (bytes.readUInt8(6) & 15) | 128;
  bytes[8] = (bytes.readUInt8(8) & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function listInternalProjects(db: Db, who: NativeSessionRef, signal: AbortSignal) {
  return withInternalProjects<ProjectIndex>(db, who, signal, async (tx, actor) => {
    const projects = await tx
      .select({
        id: agencyProjects.id,
        title: agencyProjects.title,
        owner: personFields,
        createdAt: agencyProjects.createdAt,
      })
      .from(agencyProjects)
      .innerJoin(users, eq(users.id, agencyProjects.ownerUserId))
      .where(listInternalProjectScope(tx, actor.id))
      .orderBy(desc(agencyProjects.createdAt), asc(agencyProjects.id));
    return ok({
      projects: projects.map((project) => ({
        ...project,
        createdAt: project.createdAt.toISOString(),
      })),
      canCreate: can(actor, "project.create"),
    });
  });
}

export function readInternalProject(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectWorkspace>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "read");
    return access.ok ? ok(await projectWorkspaceSnapshot(tx, access.value)) : access;
  });
}

export function createInternalProject(
  db: Db,
  who: NativeSessionRef,
  input: CreateProjectInput,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectSummary>(db, who, signal, async (tx, actor) => {
    if (!can(actor, "project.create")) return err("project_forbidden");
    const id = intentRecordId("project", actor.id, input.id);
    const [inserted] = await tx
      .insert(agencyProjects)
      .values({ id, kind: "internal", ownerUserId: actor.id, title: input.title })
      .onConflictDoNothing({ target: agencyProjects.id })
      .returning({
        state: agencyProjects.state,
        revision: agencyProjects.revision,
        archivedFrom: agencyProjects.archivedFrom,
        createdAt: agencyProjects.createdAt,
      });
    const owner = { id: actor.id, name: actor.name };
    if (inserted === undefined) {
      const [existing] = await tx
        .select({ title: agencyProjects.title, createdAt: agencyProjects.createdAt })
        .from(agencyProjects)
        .where(
          and(
            eq(agencyProjects.id, id),
            eq(agencyProjects.kind, "internal"),
            eq(agencyProjects.ownerUserId, actor.id),
          ),
        );
      if (existing?.title !== input.title) return err("project_conflict");
      return ok({ id, title: input.title, owner, createdAt: existing.createdAt.toISOString() });
    }
    const recorded = await appendProjectHistory(
      { db: tx, actor },
      "create",
      id,
      null,
      inserted,
      signal,
    );
    if (!recorded.ok)
      throw new AppError(
        ERROR_IDS.DB_INVARIANT,
        "Internal project creation did not record its history",
      );
    return ok({ id, title: input.title, owner, createdAt: inserted.createdAt.toISOString() });
  });
}

function changeWorkspace(
  db: Db,
  who: NativeSessionRef,
  projectId: string,
  capability: "canEdit" | "canAssign" | "canManageMembers",
  signal: AbortSignal,
  change: (tx: Db, access: InternalProjectAccess) => Promise<ProjectResult<undefined>>,
) {
  return withInternalProjects<ProjectWorkspace>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "write");
    if (!access.ok) return access;
    if (!access.value[capability]) return err("project_forbidden");
    const result = await change(tx, access.value);
    return result.ok ? ok(await projectWorkspaceSnapshot(tx, access.value)) : result;
  });
}

export function createInternalProjectItem(
  db: Db,
  who: NativeSessionRef,
  input: CreateProjectItemInput,
  signal: AbortSignal,
) {
  const { projectId } = input;
  const content = initialProjectItemContent(input);
  const { assigneeId, startDate, dueDate } = content;
  return changeWorkspace(
    db,
    who,
    projectId,
    assigneeId === null ? "canEdit" : "canAssign",
    signal,
    async (tx, access) => {
      if (!validProjectItemDates(startDate, dueDate)) return err("project_invalid");
      if (assigneeId !== null && !(await canAssignStaff(tx, access, assigneeId)))
        return err("project_invalid");
      const id = intentRecordId(projectId, who.userId, input.id);
      const [inserted] = await tx
        .insert(internalProjectItems)
        .values({ ...content, id, projectId, createdBy: who.userId })
        .onConflictDoNothing({ target: internalProjectItems.id })
        .returning({ id: internalProjectItems.id });
      if (inserted !== undefined) {
        await recordProjectItemEvent(tx, {
          itemId: inserted.id,
          actorId: who.userId,
          kind: "created",
        });
        return ok(undefined);
      }
      const [existing] = await tx
        .select({ ...projectItemContentFields, revision: internalProjectItems.revision })
        .from(internalProjectItems)
        .where(and(eq(internalProjectItems.id, id), eq(internalProjectItems.projectId, projectId)));
      if (
        existing === undefined ||
        (existing.revision === 0 && !matchesInitialProjectItemContent(existing, content))
      )
        return err("project_conflict");
      return ok(undefined);
    },
  );
}

async function canAssignStaff(db: Db, access: InternalProjectAccess, userId: string) {
  if (access.summary.owner.id === userId) return access.ownerEligible;
  const [member] = await db
    .select({ id: users.id })
    .from(agencyProjectMembers)
    .innerJoin(users, eq(users.id, agencyProjectMembers.userId))
    .where(and(eq(agencyProjectMembers.projectId, access.summary.id), eligibleStaff(userId)));
  return member !== undefined;
}

export function updateInternalProjectItem(
  db: Db,
  who: NativeSessionRef,
  input: UpdateProjectItemInput,
  signal: AbortSignal,
) {
  const { projectId, itemId, revision, ...content } = input;
  const { assigneeId, startDate, dueDate } = content;
  return changeWorkspace(
    db,
    who,
    projectId,
    assigneeId === undefined ? "canEdit" : "canAssign",
    signal,
    async (tx, access) => {
      const target = and(
        eq(internalProjectItems.projectId, projectId),
        eq(internalProjectItems.id, itemId),
      );
      const [item] = await tx
        .select({ ...projectItemContentFields, revision: internalProjectItems.revision })
        .from(internalProjectItems)
        .where(target);
      if (item === undefined) return err("project_unavailable");
      if (item.revision !== revision || revision === Number.MAX_SAFE_INTEGER)
        return err("project_conflict");
      if (
        !validProjectItemDates(
          startDate === undefined ? item.startDate : startDate,
          dueDate === undefined ? item.dueDate : dueDate,
        )
      )
        return err("project_invalid");
      if (assigneeId != null && !(await canAssignStaff(tx, access, assigneeId)))
        return err("project_invalid");
      const changes = {
        title: content.title,
        status: content.status,
        assigneeId,
        priority: content.priority,
        startDate,
        dueDate,
        description: content.description,
      };
      const fields = Object.keys(changes) as (keyof typeof changes)[];
      if (!fields.some((field) => changes[field] !== undefined && changes[field] !== item[field]))
        return ok(undefined);

      const [updated] = await tx
        .update(internalProjectItems)
        .set({ ...changes, revision: revision + 1 })
        .where(and(target, eq(internalProjectItems.revision, revision)))
        .returning({ id: internalProjectItems.id });
      if (updated === undefined) return err("project_conflict");
      await recordProjectItemEvent(tx, {
        itemId: updated.id,
        actorId: who.userId,
        kind: "updated",
      });
      return ok(undefined);
    },
  );
}

export function setInternalProjectMember(
  db: Db,
  who: NativeSessionRef,
  input: SetProjectMemberInput,
  signal: AbortSignal,
) {
  const { projectId, userId, membership } = input;
  return changeWorkspace(db, who, projectId, "canManageMembers", signal, async (tx, access) => {
    if (userId === access.summary.owner.id) return err("project_invalid");
    if (membership === null) {
      const assigned = and(
        eq(internalProjectItems.projectId, projectId),
        eq(internalProjectItems.assigneeId, userId),
      );
      const [exhausted] = await tx
        .select({ id: internalProjectItems.id })
        .from(internalProjectItems)
        .where(and(assigned, eq(internalProjectItems.revision, Number.MAX_SAFE_INTEGER)))
        .limit(1);
      if (exhausted !== undefined) return err("project_conflict");
      await tx
        .update(internalProjectItems)
        .set({ assigneeId: null, revision: sql`${internalProjectItems.revision} + 1` })
        .where(assigned);
      await tx
        .delete(agencyProjectMembers)
        .where(
          and(
            eq(agencyProjectMembers.projectId, projectId),
            eq(agencyProjectMembers.userId, userId),
          ),
        );
    } else {
      const [staff] = await tx.select({ id: users.id }).from(users).where(eligibleStaff(userId));
      if (staff === undefined) return err("project_invalid");
      const grants = {
        projectEdit: membership.role === "editor",
        assignmentCoordinate: membership.canAssign,
      };
      await tx
        .insert(agencyProjectMembers)
        .values({ projectId, userId, ...grants })
        .onConflictDoUpdate({
          target: [agencyProjectMembers.projectId, agencyProjectMembers.userId],
          set: grants,
        });
    }
    return ok(undefined);
  });
}
