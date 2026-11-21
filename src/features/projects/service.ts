import { createHash } from "node:crypto";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
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
  isEligibleProjectMember,
  listInternalProjectScope,
  lockInternalProject,
  personFields,
  projectItemContentFields,
  projectWorkspaceSnapshot,
  readInternalProjectSettings,
  withInternalProjects,
} from "./access";
import {
  type CreateProjectInput,
  type CreateProjectItemInput,
  type ProjectIndex,
  type ProjectItemContent,
  type ProjectResult,
  type ProjectSummary,
  type ProjectWorkspace,
  projectStateLegacyStatus,
  type SetProjectMemberInput,
  type UpdateProjectItemInput,
} from "./contracts";
import {
  initialProjectItemContent,
  matchesInitialProjectItemContent,
  validProjectItemDates,
} from "./input";
import { attachNewItemPlanning, validateNewItemPlanning } from "./planning/assignments";
import { internalProjectPlanningAssignments } from "./planning/schema";
import { recordProjectItemEvent } from "./profile/events";
import { internalProjectItems, internalProjectSettings } from "./schema";
import { findProjectWorkflowState, readProjectWorkflowStates } from "./settings/states";

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
        identifier: internalProjectSettings.identifier,
        owner: personFields,
        createdAt: agencyProjects.createdAt,
        state: agencyProjects.state,
      })
      .from(agencyProjects)
      .innerJoin(users, eq(users.id, agencyProjects.ownerUserId))
      .innerJoin(internalProjectSettings, eq(internalProjectSettings.projectId, agencyProjects.id))
      .where(listInternalProjectScope(tx, actor.id))
      .orderBy(desc(agencyProjects.createdAt), asc(agencyProjects.id));
    return ok({
      projects: projects.map(({ state, ...project }) => ({
        ...project,
        createdAt: project.createdAt.toISOString(),
        archived: state === "archived",
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
        .select({
          title: agencyProjects.title,
          identifier: internalProjectSettings.identifier,
          createdAt: agencyProjects.createdAt,
          state: agencyProjects.state,
          creationTitle: internalProjectSettings.creationTitle,
        })
        .from(agencyProjects)
        .innerJoin(
          internalProjectSettings,
          eq(internalProjectSettings.projectId, agencyProjects.id),
        )
        .where(
          and(
            eq(agencyProjects.id, id),
            eq(agencyProjects.kind, "internal"),
            eq(agencyProjects.ownerUserId, actor.id),
          ),
        );
      if (existing === undefined || (existing.creationTitle ?? existing.title) !== input.title)
        return err("project_conflict");
      return ok({
        id,
        title: existing.title,
        identifier: existing.identifier,
        owner,
        createdAt: existing.createdAt.toISOString(),
        archived: existing.state === "archived",
      });
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
    const [settings] = await tx
      .select({ identifier: internalProjectSettings.identifier })
      .from(internalProjectSettings)
      .where(eq(internalProjectSettings.projectId, id));
    if (settings === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "New internal project is missing its identifier");
    return ok({
      id,
      title: input.title,
      identifier: settings.identifier,
      owner,
      createdAt: inserted.createdAt.toISOString(),
      archived: false,
    });
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

async function resolveInitialAssignee(
  tx: Db,
  access: InternalProjectAccess,
  requested: string | null | undefined,
): Promise<ProjectResult<string | null>> {
  if (requested !== undefined) {
    return requested === null || (await isEligibleProjectMember(tx, access, requested))
      ? ok(requested)
      : err("project_invalid");
  }
  if (!access.canAssign) return ok(null);
  const { defaultAssigneeId } = await readInternalProjectSettings(tx, access.summary.id);
  return ok(
    defaultAssigneeId !== null && (await isEligibleProjectMember(tx, access, defaultAssigneeId))
      ? defaultAssigneeId
      : null,
  );
}

async function checkProjectItemCreateReplay(
  tx: Db,
  id: string,
  input: CreateProjectItemInput,
  existing: ProjectItemContent & { stateId: string | null; revision: number },
): Promise<ProjectResult<undefined>> {
  if (existing.revision > 0) return ok(undefined);
  const repeatedContent = initialProjectItemContent({
    ...input,
    status: input.stateId === undefined ? (input.status ?? existing.status) : existing.status,
    assigneeId: input.assigneeId === undefined ? existing.assigneeId : input.assigneeId,
  });
  if (
    !matchesInitialProjectItemContent(existing, repeatedContent) ||
    (input.stateId !== undefined && existing.stateId !== input.stateId)
  )
    return err("project_conflict");
  if (
    input.planning !== undefined &&
    !(await matchesProjectItemCreatePlanning(tx, input.projectId, id, input.planning))
  )
    return err("project_conflict");
  return ok(undefined);
}

async function matchesProjectItemCreatePlanning(
  tx: Db,
  projectId: string,
  itemId: string,
  { cycleId, moduleId }: NonNullable<CreateProjectItemInput["planning"]>,
) {
  const assignments = internalProjectPlanningAssignments;
  const { groupId, kind } = assignments;
  const cycle = cycleId === undefined ? undefined : and(eq(kind, "cycles"), eq(groupId, cycleId));
  const moduleMatch =
    moduleId === undefined ? undefined : and(eq(kind, "modules"), eq(groupId, moduleId));
  const expected = [cycle, moduleMatch].filter((part) => part !== undefined).length;
  if (expected === 0) return true;
  const links = await tx
    .select({ groupId })
    .from(assignments)
    .where(
      and(
        eq(assignments.projectId, projectId),
        eq(assignments.itemId, itemId),
        or(cycle, moduleMatch),
      ),
    );
  return links.length === expected;
}

export function createInternalProjectItem(
  db: Db,
  who: NativeSessionRef,
  input: CreateProjectItemInput,
  signal: AbortSignal,
) {
  const { projectId, assigneeId, startDate, dueDate } = input;
  return changeWorkspace(
    db,
    who,
    projectId,
    assigneeId == null ? "canEdit" : "canAssign",
    signal,
    async (tx, access) => {
      if (!validProjectItemDates(startDate, dueDate)) return err("project_invalid");
      const id = intentRecordId(projectId, who.userId, input.id);
      // This project is write-locked. Check the intent before INSERT so retries
      // do not use the next issue number in the database's insert trigger.
      const [existing] = await tx
        .select({
          ...projectItemContentFields,
          revision: internalProjectItems.revision,
          stateId: internalProjectItems.stateId,
        })
        .from(internalProjectItems)
        .where(and(eq(internalProjectItems.id, id), eq(internalProjectItems.projectId, projectId)));
      if (existing !== undefined) return checkProjectItemCreateReplay(tx, id, input, existing);
      const initialAssignee = await resolveInitialAssignee(tx, access, assigneeId);
      if (!initialAssignee.ok) return initialAssignee;
      const states = await readProjectWorkflowStates(tx, projectId);
      const state = findProjectWorkflowState(states, input.stateId, input.status);
      if (state === undefined) return err("project_invalid");
      if (
        input.planning !== undefined &&
        !(await validateNewItemPlanning(tx, projectId, input.planning))
      )
        return err("project_invalid");
      const content = initialProjectItemContent({
        ...input,
        assigneeId: initialAssignee.value,
        status: projectStateLegacyStatus(state.category),
      });
      await tx
        .insert(internalProjectItems)
        .values({ ...content, id, projectId, stateId: state.id, createdBy: who.userId });
      if (input.planning !== undefined)
        await attachNewItemPlanning(tx, projectId, id, input.planning);
      await recordProjectItemEvent(tx, { itemId: id, actorId: who.userId, kind: "created" });
      return ok(undefined);
    },
  );
}

export function updateInternalProjectItem(
  db: Db,
  who: NativeSessionRef,
  input: UpdateProjectItemInput,
  signal: AbortSignal,
) {
  const { projectId, itemId, revision, stateId, ...content } = input;
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
        .select({
          ...projectItemContentFields,
          revision: internalProjectItems.revision,
          stateId: internalProjectItems.stateId,
        })
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
      if (assigneeId != null && !(await isEligibleProjectMember(tx, access, assigneeId)))
        return err("project_invalid");
      let state: ReturnType<typeof findProjectWorkflowState>;
      if (
        stateId !== undefined ||
        (content.status !== undefined && content.status !== item.status)
      ) {
        const states = await readProjectWorkflowStates(tx, projectId);
        state = findProjectWorkflowState(states, stateId, content.status);
        if (state === undefined) return err("project_invalid");
      }
      const changes = {
        title: content.title,
        status: state === undefined ? undefined : projectStateLegacyStatus(state.category),
        stateId: state?.id,
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
      await tx
        .update(internalProjectSettings)
        .set({
          leadUserId: sql`CASE WHEN ${internalProjectSettings.leadUserId} = ${userId} THEN NULL ELSE ${internalProjectSettings.leadUserId} END`,
          defaultAssigneeId: sql`CASE WHEN ${internalProjectSettings.defaultAssigneeId} = ${userId} THEN NULL ELSE ${internalProjectSettings.defaultAssigneeId} END`,
          revision: sql`LEAST(${internalProjectSettings.revision} + 1, 9007199254740991)`,
        })
        .where(
          and(
            eq(internalProjectSettings.projectId, projectId),
            or(
              eq(internalProjectSettings.leadUserId, userId),
              eq(internalProjectSettings.defaultAssigneeId, userId),
            ),
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
