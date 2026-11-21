import type { Db } from "@/db/client";
import { createRateLimiter } from "@/server/rateLimit";
import { workItemActivity } from "./activity";
import { projectLabels, projectMembers, projectStates } from "./catalog";
import { projectIntegratorWorkspace } from "./contracts";
import { apiJson, key, methodNotAllowed, missing, ProjectApiError } from "./httpSupport";
import { intakeCollection, intakeDetail } from "./intake";
import {
  archiveProject,
  type Operation,
  projectCollection,
  projectDetail,
  projectSummary,
} from "./operations";
import { planningWorkItems, projectPlanning, transferCycleItems } from "./planning";
import { authorizeProjectIntegrator, noteProjectIntegratorUse } from "./principal";
import {
  archivedWorkItems,
  searchWorkItems,
  workItemArchive,
  workItemByIdentifier,
  workItemDetail,
  workItemList,
} from "./workItems";

const limit = createRateLimiter({ limit: 60, windowMs: 60_000 });

function lifecycle(action: string | undefined) {
  if (action === undefined) return undefined;
  if (action === "archive" || action === "unarchive") return action;
  return missing();
}

type ObjectRoute = (op: Operation, projectId: string, id?: string) => Promise<Response>;
const catalogRoutes = new Map<string, ObjectRoute>([
  ["states", projectStates],
  ["labels", projectLabels],
  ["members", projectMembers],
  ["project-members", projectMembers],
  [
    "project-members-lite",
    (op, projectId, id) => {
      if (op.request.method !== "GET") return methodNotAllowed();
      return projectMembers(op, projectId, id);
    },
  ],
  [
    "intake-issues",
    (op, projectId, id) =>
      id === undefined ? intakeCollection(op, projectId) : intakeDetail(op, projectId, id),
  ],
]);

function workRoutes(
  op: Operation,
  projectId: string,
  object: string | undefined,
  action: string | undefined,
  child: string | undefined,
) {
  if (object === undefined) return workItemList(op, projectId);
  const id = key(object);
  if (action === "activities")
    return workItemActivity(op, projectId, id, child === undefined ? undefined : key(child));
  if (child !== undefined) return missing();
  if (action === undefined) return workItemDetail(op, projectId, id);
  if (action === "archive") return workItemArchive(op, projectId, id);
  return missing();
}

function planningRoutes(op: Operation, projectId: string, resource: string, path: string[]) {
  const [object, action, child] = path;
  const kind = resource.includes("cycles") ? "cycles" : "modules";
  const id = object === undefined ? undefined : key(object);
  const related = kind === "cycles" ? "cycle-issues" : "module-issues";
  if (id !== undefined && action === related)
    return planningWorkItems(op, projectId, kind, id, child === undefined ? undefined : key(child));
  if (child !== undefined) return missing();
  if (kind === "cycles" && id !== undefined && action === "transfer-issues")
    return transferCycleItems(op, projectId, id);
  if (resource.endsWith("-lite") && (op.request.method !== "GET" || id !== undefined))
    return methodNotAllowed();
  return projectPlanning(
    op,
    projectId,
    kind,
    id,
    lifecycle(action),
    resource.startsWith("archived-"),
  );
}

function projectChildren(op: Operation, projectId: string, path: string[]) {
  const [resource, object, action, child] = path;
  if (resource === undefined) return projectDetail(op, projectId);
  if (path.length > 4) return missing();
  const catalog = catalogRoutes.get(resource);
  if (catalog !== undefined && path.length <= 2)
    return catalog(op, projectId, object === undefined ? undefined : key(object));
  if (/^(?:archived-)?(?:cycles|modules)(?:-lite)?$/.test(resource))
    return planningRoutes(op, projectId, resource, path.slice(1));
  if (resource === "work-items" || resource === "issues")
    return workRoutes(op, projectId, object, action, child);
  if (path.length !== 1) return missing();
  if (resource === "summary") return projectSummary(op, projectId);
  if (resource === "archive") return archiveProject(op, projectId);
  if (resource === "archived-work-items" || resource === "archived-issues")
    return archivedWorkItems(op, projectId);
  return missing();
}

function dispatch(op: Operation, path: string[]) {
  const [first, second, ...rest] = path;
  if (first === "projects-lite" && second === undefined) return projectCollection(op, true);
  if (first === "projects") {
    return second === undefined
      ? projectCollection(op, false)
      : projectChildren(op, key(second), rest);
  }
  if ((first === "work-items" || first === "issues") && second !== undefined && rest.length === 0)
    return second === "search" ? searchWorkItems(op) : workItemByIdentifier(op, second);
  return missing();
}

export async function projectIntegratorRequest(
  db: Db,
  request: Request,
  slug: string,
  path: string[],
) {
  if (request.method !== "HEAD") return runRequest(db, request, slug, path);
  const response = await runRequest(db, new Request(request, { method: "GET" }), slug, path);
  return new Response(null, { status: response.status, headers: response.headers });
}

async function runRequest(db: Db, request: Request, slug: string, path: string[]) {
  if (slug !== projectIntegratorWorkspace) return apiJson({ error: "workspace_not_found" }, 404);
  const url = new URL(request.url);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const required = request.method === "GET" ? "read" : "write";
  try {
    const auth = await authorizeProjectIntegrator(
      db,
      request.headers.get("x-api-key"),
      required,
      signal,
    );
    if (!auth.ok) return apiJson({ error: auth.error }, auth.error === "unauthorized" ? 401 : 403);
    const actor = auth.value;
    const allowance = limit.check(actor.keyId, Date.now());
    if (!allowance.allowed) {
      return apiJson({ error: "rate_limited" }, 429, {
        "Retry-After": String(allowance.retryAfterSeconds),
      });
    }
    await noteProjectIntegratorUse(db, actor);
    return await dispatch({ actor, db, request, url, signal }, path);
  } catch (error) {
    if (error instanceof ProjectApiError) return apiJson({ error: error.code }, error.status);
    if (signal.aborted) return apiJson({ error: "request_timeout" }, 503);
    throw error;
  }
}
