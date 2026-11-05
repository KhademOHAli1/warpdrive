import { z } from "zod";
import { type Db, db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { workflowCsrf } from "@/features/auth/better/workflowHttp";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { boundedBody } from "@/features/billing/http";
import { invalidateDefsCache } from "@/features/custom-fields/defsRepo";
import { hydrateActor } from "@/server/hydrateActor";
import { commandSchema, localeSchema, type WorkCommand } from "./contracts";
import { WorkRollback } from "./errors";
import { querySchema, workFailure, workResult } from "./http";
import { WorkService } from "./service";

async function parseCommand(request: Request, signal: AbortSignal): Promise<WorkCommand | null> {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return null;
  try {
    const parsed = commandSchema.safeParse(JSON.parse(await boundedBody(request, 131072, signal)));
    return parsed.success ? parsed.data : null;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}
async function readOverview(service: WorkService, params: Record<string, string>) {
  const parsed = z
    .object({ locale: localeSchema.default("en") })
    .strict()
    .safeParse(params);
  return parsed.success
    ? workResult(await service.overview(parsed.data.locale))
    : workFailure("invalid_input");
}

async function readCollection(service: WorkService, kind: string, params: Record<string, string>) {
  switch (kind) {
    case "overview":
      return readOverview(service, params);
    case "options":
      return workResult(await service.options());
    case "items": {
      const parsed = querySchema.safeParse(params);
      return parsed.success
        ? workResult(await service.items(parsed.data))
        : workFailure("invalid_input");
    }
    default:
      return workFailure("not_found");
  }
}

async function readRequest(service: WorkService, request: Request, path: string[]) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const [kind, rawId] = path;
  if (path.length === 0) return readOverview(service, params);
  if (path.length === 1 && kind !== undefined) return readCollection(service, kind, params);
  if (path.length !== 2 || (kind !== "operations" && kind !== "items"))
    return workFailure("not_found");
  const id = z.string().uuid().safeParse(rawId);
  if (!id.success) return workFailure("invalid_input");
  return kind === "operations"
    ? workResult(await service.operation(id.data))
    : workResult(await service.item(id.data));
}

export function createWorkRequest(rootDb: Db) {
  return async function workRequest(request: Request, path: string[]): Promise<Response> {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
    try {
      const mutation = request.method === "POST";
      if (mutation && !workflowCsrf(request)) return workFailure("forbidden");
      const input = mutation ? await parseCommand(request, signal) : null;
      if (mutation && input === null) return workFailure("invalid_input");
      const fresh = input?.action === "apply" || input?.action === "undo";
      const session = await resolveWorkflowSession(rootDb, request.headers, signal, {
        requireFresh: fresh,
      });
      if (!session) return workFailure(fresh ? "fresh_auth_required" : "unauthorized");
      if (
        !(await enforceAuthRateLimit(
          rootDb,
          request.headers,
          mutation ? "/work-profile" : "/snapshot",
          session.user.id,
          signal,
        ))
      )
        return workFailure("rate_limited");
      const response = await withCurrentAuthority(rootDb, "read", signal, async (tx) => {
        const live = await resolveWorkflowSession(tx, request.headers, signal, {
          requireFresh: fresh,
        });
        if (!live || live.user.id !== session.user.id) throw new WorkRollback("unauthorized");
        const actor = await hydrateActor(tx, live.user.id, signal);
        if (!actor) throw new WorkRollback("forbidden");
        const service = new WorkService(tx, actor, signal);
        if (input === null) return readRequest(service, request, path);
        if (path.length !== 0) return workFailure("not_found");
        return workResult(await service.command(input));
      });
      // The outer current-authority transaction has committed before invalidating root-db caches.
      if (response.ok && (input?.action === "apply" || input?.action === "undo"))
        invalidateDefsCache(rootDb);
      return response;
    } catch (error) {
      signal.throwIfAborted();
      return workFailure(error instanceof WorkRollback ? error.code : "unavailable");
    }
  };
}
export const workRequest = createWorkRequest(db);
