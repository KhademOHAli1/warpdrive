import { z } from "zod";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { ProjectWorkspace } from "../contracts";
import { createProjectInput, saveProjectSettingsInput } from "../input";
import { createInternalProject, listInternalProjects, readInternalProject } from "../service";
import { saveInternalProjectSettings, setInternalProjectArchived } from "../settings/service";
import {
  apiJson,
  apiPage,
  body,
  intent,
  methodNotAllowed,
  missing,
  parsed,
  returned,
} from "./httpSupport";
import type { ProjectIntegratorPrincipal } from "./principal";
import { projectDto } from "./wire";

export type Operation = {
  db: Db;
  actor: ProjectIntegratorPrincipal;
  request: Request;
  signal: AbortSignal;
  url: URL;
};

export async function workspace(op: Operation, projectId: string) {
  return returned(await readInternalProject(op.db, op.actor, projectId, op.signal));
}

export async function projectCatalog(op: Operation, projectId: string) {
  const result = await workspace(op, projectId);
  if (result.guestAccess === "restricted") return missing();
  return result;
}

const settingsBody = z.strictObject({
  name: z.string().optional(),
  identifier: z.string().optional(),
  description: z.string().optional(),
  timezone: z.string().optional(),
  project_lead: z.uuid().nullish(),
  default_assignee: z.uuid().nullish(),
});

async function saveSettings(
  op: Operation,
  current: ProjectWorkspace,
  change: z.output<typeof settingsBody>,
) {
  const input = parsed(saveProjectSettingsInput, {
    projectId: current.project.id,
    revision: current.settings.revision,
    title: change.name ?? current.project.title,
    description: change.description ?? current.settings.description,
    identifier: change.identifier,
    timeZone: change.timezone,
    leadUserId: change.project_lead,
    defaultAssigneeId: change.default_assignee,
  });
  return returned(await saveInternalProjectSettings(op.db, op.actor, input, op.signal));
}

async function createProject(op: Operation) {
  const change = parsed(
    settingsBody.extend({ name: z.string() }),
    await body(op.request, op.signal),
  );
  const input = parsed(createProjectInput, { id: intent(op.request), title: change.name });
  return withCurrentAuthority(op.db, "read", op.signal, async (db) => {
    const created = returned(await createInternalProject(db, op.actor, input, op.signal));
    const context = { ...op, db };
    const current = await workspace(context, created.id);
    const updated =
      current.settings.revision === 0 ? await saveSettings(context, current, change) : current;
    return apiJson(projectDto(updated.project, updated.settings), 201);
  });
}

export async function projectCollection(op: Operation, lite: boolean) {
  if (op.request.method === "GET") {
    const { projects } = returned(await listInternalProjects(op.db, op.actor, op.signal));
    const rows = projects.filter(({ archived }) => !archived).map((project) => projectDto(project));
    return lite ? apiJson(rows) : apiPage(op.url, rows);
  }
  if (op.request.method === "POST" && !lite) return createProject(op);
  return methodNotAllowed();
}

export async function projectDetail(op: Operation, projectId: string) {
  const current = await workspace(op, projectId);
  if (op.request.method === "GET")
    return apiJson(
      projectDto(
        current.project,
        current.guestAccess === "restricted" ? undefined : current.settings,
      ),
    );
  if (op.request.method === "PATCH") {
    const change = parsed(settingsBody, await body(op.request, op.signal));
    const next = await saveSettings(op, current, change);
    return apiJson(projectDto(next.project, next.settings));
  }
  if (op.request.method === "DELETE") return archiveProject(op, projectId, true);
  return methodNotAllowed();
}

export async function archiveProject(op: Operation, projectId: string, deleting = false) {
  const method = op.request.method;
  if (method !== "POST" && method !== "DELETE") return methodNotAllowed();
  const current = await workspace(op, projectId);
  const after = returned(
    await setInternalProjectArchived(
      op.db,
      op.actor,
      {
        projectId,
        revision: current.settings.revision,
        archived: deleting || method === "POST",
      },
      op.signal,
    ),
  );
  return deleting ? apiJson(undefined, 204) : apiJson(projectDto(after.project, after.settings));
}

export async function projectSummary(op: Operation, projectId: string) {
  if (op.request.method !== "GET") return methodNotAllowed();
  const current = await workspace(op, projectId);
  return apiJson({
    ...projectDto(current.project, current.settings),
    total_issues: current.items.length,
    issue_by_state: current.states.map((state) => ({
      state: state.id,
      name: state.name,
      count: current.items.filter((item) => item.stateId === state.id).length,
    })),
  });
}
