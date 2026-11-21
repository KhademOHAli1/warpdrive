import { sanitize } from "isomorphic-dompurify";
import { z } from "zod";
import { ok } from "@/types/result";
import { lockInternalProject, projectWorkspaceSnapshot, withInternalProjects } from "../access";
import { archiveProjectItem, readArchivedProjectItems } from "../automations/service";
import type { ProjectItem } from "../contracts";
import { createProjectItemInput, updateProjectItemInput } from "../input";
import {
  createInternalProjectItemInTransaction,
  listInternalProjects,
  readInternalProject,
  updateInternalProjectItem,
} from "../service";
import { projectIntegratorWorkspace } from "./contracts";
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
import { type Operation, workspace } from "./operations";
import { workItemDto } from "./wire";

const inputs = z.strictObject({
  name: z.string().optional(),
  state: z.uuid().optional(),
  assignees: z.array(z.uuid()).max(1).optional(),
  labels: z.array(z.uuid()).max(100).optional(),
  estimate_point: z.uuid().nullish(),
  priority: createProjectItemInput.shape.priority,
  start_date: createProjectItemInput.shape.startDate,
  target_date: createProjectItemInput.shape.dueDate,
  description: z.string().optional(),
  description_html: z.string().max(32000).optional(),
  cycle: z.uuid().optional(),
  module: z.uuid().optional(),
});

export function workDescription(html: string) {
  const element = sanitize(html.replace(/<(?:br\s*\/?|\/p|\/li|\/div)>/gi, "$&\n"), {
    RETURN_DOM: true,
  });
  return element.textContent?.trim() ?? "";
}

export function itemChanges(input: z.output<typeof inputs>) {
  return {
    title: input.name,
    stateId: input.state,
    assigneeId: input.assignees === undefined ? undefined : (input.assignees[0] ?? null),
    labelIds: input.labels,
    estimatePointId: input.estimate_point,
    priority: input.priority,
    startDate: input.start_date,
    dueDate: input.target_date,
    description:
      input.description ??
      (input.description_html === undefined ? undefined : workDescription(input.description_html)),
  };
}

function requireItem(items: ProjectItem[], id: string) {
  return items.find((item) => item.id === id) ?? missing();
}

export async function workItemList(op: Operation, projectId: string) {
  if (op.request.method === "GET") {
    const current = await workspace(op, projectId);
    return apiPage(
      op.url,
      current.items.map((item) => workItemDto(projectId, item)),
    );
  }
  if (op.request.method !== "POST") return methodNotAllowed();
  const input = parsed(inputs.extend({ name: z.string() }), await body(op.request, op.signal));
  const planning =
    input.cycle === undefined && input.module === undefined
      ? undefined
      : { cycleId: input.cycle, moduleId: input.module };
  const command = parsed(createProjectItemInput, {
    projectId,
    id: intent(op.request),
    ...itemChanges(input),
    planning,
  });
  const item = returned(
    await withInternalProjects<ProjectItem>(op.db, op.actor, op.signal, async (tx, actor) => {
      const access = await lockInternalProject(tx, actor, projectId, "write");
      if (!access.ok) return access;
      const created = await createInternalProjectItemInTransaction(
        tx,
        access.value,
        actor.id,
        command,
      );
      if (!created.ok) return created;
      const current = await projectWorkspaceSnapshot(tx, access.value);
      return ok(requireItem(current.items, created.value.itemId));
    }),
  );
  return apiJson(workItemDto(projectId, item), 201);
}

export async function workItemDetail(op: Operation, projectId: string, itemId: string) {
  const current = await workspace(op, projectId);
  const existing = requireItem(current.items, itemId);
  if (op.request.method === "GET") return apiJson(workItemDto(projectId, existing));
  if (op.request.method === "DELETE") return workItemArchive(op, projectId, itemId, true);
  if (op.request.method !== "PATCH") return methodNotAllowed();
  const input = parsed(
    inputs.omit({ cycle: true, module: true }),
    await body(op.request, op.signal),
  );
  const command = parsed(updateProjectItemInput, {
    projectId,
    itemId,
    revision: existing.revision,
    ...itemChanges(input),
  });
  const latest = returned(await updateInternalProjectItem(op.db, op.actor, command, op.signal));
  return apiJson(workItemDto(projectId, requireItem(latest.items, itemId)));
}

export async function workItemArchive(
  op: Operation,
  projectId: string,
  itemId: string,
  deleting = false,
) {
  if (op.request.method !== "POST" && op.request.method !== "DELETE") return methodNotAllowed();
  const archive = deleting || op.request.method === "POST";
  const items = archive
    ? (await workspace(op, projectId)).items
    : returned(await readArchivedProjectItems(op.db, op.actor, projectId, op.signal));
  const item = requireItem(items, itemId);
  returned(
    await archiveProjectItem(
      op.db,
      op.actor,
      {
        projectId,
        itemId,
        revision: item.revision,
        archived: archive,
        expectedActorId: op.actor.userId,
        csrfToken: null,
      },
      op.signal,
    ),
  );
  return apiJson(undefined, 204);
}

export async function archivedWorkItems(op: Operation, projectId: string) {
  if (op.request.method !== "GET") return methodNotAllowed();
  const items = returned(await readArchivedProjectItems(op.db, op.actor, projectId, op.signal));
  return apiPage(
    op.url,
    items.map((item) => workItemDto(projectId, item)),
  );
}

export async function workItemByIdentifier(op: Operation, identifier: string) {
  if (op.request.method !== "GET") return methodNotAllowed();
  const match = /^([A-Za-z0-9]+)-(\d+)$/.exec(identifier);
  if (match === null) return missing();
  const { projects } = returned(await listInternalProjects(op.db, op.actor, op.signal));
  const project =
    projects.find(({ identifier }) => identifier.toLowerCase() === match[1]?.toLowerCase()) ??
    missing();
  const current = await workspace(op, project.id);
  const item =
    current.items.find(({ sequenceNumber }) => String(sequenceNumber) === match[2]) ?? missing();
  return apiJson(workItemDto(project.id, item));
}

export async function searchWorkItems(op: Operation) {
  if (op.request.method !== "GET") return methodNotAllowed();
  const query = parsed(z.string().trim().max(160), op.url.searchParams.get("search") ?? "");
  const count = parsed(z.int().min(1).max(100), Number(op.url.searchParams.get("limit") ?? "10"));
  if (query === "") return apiJson({ issues: [] });
  const projectId = op.url.searchParams.get("project_id");
  const inScope =
    op.url.searchParams.get("workspace_search") !== "true" && projectId !== null
      ? parsed(z.uuid(), projectId)
      : null;
  const { projects } = returned(await listInternalProjects(op.db, op.actor, op.signal));
  const visible = projects.filter(
    (project) => !project.archived && (inScope === null || inScope === project.id),
  );
  const text = query.toLowerCase();
  const numbers = new Set(query.match(/\b\d+\b/g) ?? []);
  const issues = [];
  for (const project of visible) {
    const scoped = await readInternalProject(op.db, op.actor, project.id, op.signal);
    if (!scoped.ok) continue;
    const matches = scoped.value.items.filter(
      ({ title, sequenceNumber }) =>
        title.toLowerCase().includes(text) ||
        project.identifier.toLowerCase().includes(text) ||
        numbers.has(String(sequenceNumber)),
    );
    issues.push(
      ...matches.slice(0, count - issues.length).map(({ id, title, sequenceNumber }) => ({
        id,
        name: title,
        sequence_id: sequenceNumber,
        project__identifier: project.identifier,
        project_id: project.id,
        workspace__slug: projectIntegratorWorkspace,
      })),
    );
    if (issues.length >= count) break;
  }
  return apiJson({ issues });
}
