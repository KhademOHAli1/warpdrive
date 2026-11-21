import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { transitionProject } from "@/features/agency-projects/projectLifecycle";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import { err, ok } from "@/types/result";
import {
  type InternalProjectPrincipal,
  type InternalProjectAccess,
  isEligibleProjectMember,
  lockInternalProject,
  projectWorkspaceSnapshot,
  readInternalProjectSettings,
  withInternalProjects,
} from "../access";
import { readProjectAutomationSettings } from "../automations/service";
import type { ProjectCover, ProjectLogo } from "../brand/contracts";
import { clearProjectCover, normalizeProjectCover, storeProjectCover } from "../brand/cover";
import {
  type ProjectResult,
  type ProjectSettings,
  type ProjectStateCategory,
  type ProjectWorkflowState,
  type ProjectWorkspace,
  projectStateLegacyStatus,
  projectStatuses,
  type SaveProjectSettingsInput,
  type SaveProjectStatesInput,
  type SetProjectArchivedInput,
} from "../contracts";
import { retimeProjectIntakeSnoozes } from "../intake/snoozeTimeZone";
import { internalProjectItems, internalProjectSettings, internalProjectStates } from "../schema";
import { orderProjectWorkflowStates, readProjectWorkflowStates } from "./states";

type SettingsTarget = { projectId: string; revision: number };
type SettingsChange = Partial<
  Pick<
    SaveProjectSettingsInput,
    "description" | "identifier" | "leadUserId" | "defaultAssigneeId" | "timeZone"
  > & { logo: ProjectLogo | null; cover: ProjectCover | null }
> | null;

function changeSettings(
  db: Db,
  who: InternalProjectPrincipal,
  { projectId, revision }: SettingsTarget,
  signal: AbortSignal,
  allowArchived: boolean,
  change: (
    tx: Db,
    access: InternalProjectAccess,
    settings: ProjectSettings,
  ) => Promise<ProjectResult<SettingsChange>>,
) {
  return withInternalProjects<ProjectWorkspace>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "write");
    if (!access.ok) return access;
    if (!access.value.canManageSettings || (!allowArchived && access.value.summary.archived))
      return err("project_forbidden");
    const settings = await readInternalProjectSettings(tx, projectId);
    if (settings.revision !== revision || revision === Number.MAX_SAFE_INTEGER)
      return err("project_conflict");
    const result = await change(tx, access.value, settings);
    if (!result.ok) return result;
    if (result.value === null) return ok(await projectWorkspaceSnapshot(tx, access.value));
    await tx
      .update(internalProjectSettings)
      .set({ ...result.value, revision: revision + 1 })
      .where(eq(internalProjectSettings.projectId, projectId));
    const current = await lockInternalProject(tx, actor, projectId, "read");
    return current.ok ? ok(await projectWorkspaceSnapshot(tx, current.value)) : current;
  });
}

function identifierAlreadyInUse(error: unknown): boolean {
  for (
    let cause = error, depth = 0;
    typeof cause === "object" && cause !== null && depth < 5;
    depth += 1
  ) {
    if (
      "code" in cause &&
      cause.code === "23505" &&
      "constraint" in cause &&
      cause.constraint === "internal_project_settings_identifier_key"
    )
      return true;
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return false;
}

export async function saveInternalProjectSettings(
  db: Db,
  who: InternalProjectPrincipal,
  input: SaveProjectSettingsInput,
  signal: AbortSignal,
): Promise<ProjectResult<ProjectWorkspace>> {
  try {
    return await changeSettings(db, who, input, signal, false, async (tx, access, settings) => {
      const { summary } = access;
      const oldZone = settings.timeZone ?? "UTC";
      const {
        title,
        description,
        identifier = summary.identifier,
        leadUserId = settings.leadUserId,
        defaultAssigneeId = settings.defaultAssigneeId,
        timeZone = oldZone,
        logo = summary.logo ?? null,
        coverImage,
      } = input;
      const cover = input.cover === undefined ? (summary.cover ?? null) : input.cover;
      if (
        title === summary.title &&
        description === settings.description &&
        identifier === summary.identifier &&
        leadUserId === settings.leadUserId &&
        defaultAssigneeId === settings.defaultAssigneeId &&
        timeZone === oldZone &&
        logo?.kind === summary.logo?.kind &&
        logo?.value === summary.logo?.value &&
        (logo?.kind !== "icon" ||
          (summary.logo?.kind === "icon" && logo.color === summary.logo.color)) &&
        cover?.kind === summary.cover?.kind &&
        cover?.value === summary.cover?.value &&
        coverImage === undefined
      )
        return ok(null);
      if (
        leadUserId !== null &&
        leadUserId !== settings.leadUserId &&
        !(await isEligibleProjectMember(tx, access, leadUserId))
      )
        return err("project_invalid");
      if (
        defaultAssigneeId !== null &&
        defaultAssigneeId !== settings.defaultAssigneeId &&
        !(await isEligibleProjectMember(tx, access, defaultAssigneeId))
      )
        return err("project_invalid");
      const image = coverImage === undefined ? undefined : await normalizeProjectCover(coverImage);
      if (image === null) return err("project_invalid");
      const currentCover =
        image === undefined ? cover : await storeProjectCover(tx, summary.id, image);
      if (input.cover !== undefined && summary.cover?.kind === "image")
        await clearProjectCover(tx, summary.id);
      if (timeZone !== oldZone)
        await retimeProjectIntakeSnoozes(tx, summary.id, oldZone, timeZone, new Date());
      if (title !== summary.title) {
        await tx
          .update(agencyProjects)
          .set({ title, updatedAt: new Date() })
          .where(and(eq(agencyProjects.id, summary.id), eq(agencyProjects.kind, "internal")));
      }
      return ok({
        description,
        identifier,
        leadUserId,
        defaultAssigneeId,
        timeZone,
        logo,
        cover: currentCover,
      });
    });
  } catch (error) {
    if (!identifierAlreadyInUse(error)) throw error;
    return err("project_conflict");
  }
}

export function setInternalProjectArchived(
  db: Db,
  who: InternalProjectPrincipal,
  input: SetProjectArchivedInput,
  signal: AbortSignal,
) {
  return changeSettings(db, who, input, signal, true, async (tx, { summary, lifecycle }) => {
    if (summary.archived === input.archived) return ok(null);
    const transition = transitionProject(lifecycle, {
      action: input.archived ? "archive" : "restore",
      expectedRevision: lifecycle.revision,
      reason: input.archived ? "Archived from project settings" : "Restored from project settings",
    });
    if (!transition.ok)
      return err(
        transition.error === "revision_exhausted" ? "project_conflict" : "project_invalid",
      );
    const [updated] = await tx
      .update(agencyProjects)
      .set({ ...transition.value.next, updatedAt: new Date() })
      .where(
        and(
          eq(agencyProjects.id, summary.id),
          eq(agencyProjects.kind, "internal"),
          eq(agencyProjects.revision, lifecycle.revision),
        ),
      )
      .returning({ id: agencyProjects.id });
    return updated === undefined ? err("project_conflict") : ok({});
  });
}

function normalizePositions(states: readonly ProjectWorkflowState[]) {
  const counts = new Map<ProjectStateCategory, number>();
  return orderProjectWorkflowStates(states).map((state) => {
    const position = counts.get(state.category) ?? 0;
    counts.set(state.category, position + 1);
    return { ...state, position };
  });
}

function sameState(left: ProjectWorkflowState, right: ProjectWorkflowState | undefined) {
  return (
    right !== undefined &&
    left.id === right.id &&
    left.name === right.name &&
    left.category === right.category &&
    left.position === right.position &&
    left.color === right.color &&
    left.isDefault === right.isDefault
  );
}

export function saveInternalProjectStates(
  db: Db,
  who: InternalProjectPrincipal,
  input: SaveProjectStatesInput,
  signal: AbortSignal,
) {
  return changeSettings(db, who, input, signal, false, async (tx) => {
    const { projectId } = input;
    const before = await readProjectWorkflowStates(tx, projectId);
    const states = normalizePositions(input.states);
    if (
      states.length === before.length &&
      states.every((state, index) => sameState(state, before[index]))
    )
      return ok(null);
    const afterById = new Map(states.map((state) => [state.id, state]));
    const automation = await readProjectAutomationSettings(tx, projectId);
    if (
      automation.closeStateId !== null &&
      afterById.get(automation.closeStateId)?.category !== "cancelled"
    )
      return err("project_conflict");
    const removed = before.filter(({ id }) => !afterById.has(id)).map(({ id }) => id);
    const recategorized = before.flatMap((previous) => {
      const next = afterById.get(previous.id);
      if (next === undefined) return [];
      const status = projectStateLegacyStatus(next.category);
      return status === projectStateLegacyStatus(previous.category)
        ? []
        : [{ id: next.id, status }];
    });
    const items = internalProjectItems;
    if (removed.length > 0) {
      const [used] = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.projectId, projectId), inArray(items.stateId, removed)))
        .limit(1);
      if (used !== undefined) return err("project_conflict");
    }
    if (recategorized.length > 0) {
      const [exhausted] = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.projectId, projectId),
            inArray(
              items.stateId,
              recategorized.map(({ id }) => id),
            ),
            eq(items.revision, Number.MAX_SAFE_INTEGER),
          ),
        )
        .limit(1);
      if (exhausted !== undefined) return err("project_conflict");
    }
    await tx
      .insert(internalProjectStates)
      .values(states.map((state) => ({ ...state, projectId })))
      .onConflictDoUpdate({
        target: [internalProjectStates.projectId, internalProjectStates.id],
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          position: sql`excluded.position`,
          color: sql`excluded.color`,
          isDefault: sql`excluded.is_default`,
        },
      });
    if (removed.length > 0) {
      await tx
        .delete(internalProjectStates)
        .where(
          and(
            eq(internalProjectStates.projectId, projectId),
            inArray(internalProjectStates.id, removed),
          ),
        );
    }
    for (const status of projectStatuses) {
      const moved = recategorized.filter((state) => state.status === status).map(({ id }) => id);
      if (moved.length === 0) continue;
      await tx
        .update(items)
        .set({ status, revision: sql`${items.revision} + 1` })
        .where(and(eq(items.projectId, projectId), inArray(items.stateId, moved)));
    }
    return ok({});
  });
}
