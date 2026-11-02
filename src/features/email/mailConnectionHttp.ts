import { NextResponse } from "next/server";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import type { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { readCookie } from "@/features/auth/better/sessionToken";
import { workflowCsrf } from "@/features/auth/better/workflowHttp";
import { CSRF_COOKIE, mintCsrfToken } from "@/features/auth/csrf";
import type { MailboxConnectionError, MailboxConnectionResult } from "./connections/types";
import { listActorMailboxes } from "./mailAccountsRepo";
import { checkMailboxConnection } from "./mailConnectionCheck";
import { commitMailboxProof } from "./mailConnectionCommit";
import { resolveMailboxHttpContext } from "./mailConnectionHttpAuth";
import { readMailboxRequestBody } from "./mailConnectionHttpBody";
import { withMailboxRequestSignal } from "./mailConnectionHttpSignal";
import { mutateMailboxConnection } from "./mailConnectionMutations";

const HTTP_TIMEOUT_MS = 30_000;
const ERROR_STATUS: Record<MailboxConnectionError, number> = {
  authentication: 400,
  tls: 400,
  network: 502,
  permission: 403,
  duplicate: 409,
  invalid_input: 400,
  rate_limit: 429,
  stale_check: 409,
  fresh_auth_required: 403,
  unsupported: 400,
  connection_changed: 409,
  delivery_unknown: 409,
  unknown: 500,
};

interface MailConnectionHttpDependencies {
  check?: typeof checkMailboxConnection;
  save?: typeof commitMailboxProof;
  mutate?: typeof mutateMailboxConnection;
  list?: typeof listActorMailboxes;
  rateLimit?: typeof enforceAuthRateLimit;
  timeoutMs?: number;
}

function json(
  result: MailboxConnectionResult<unknown>,
  status: number,
  request: Request,
): Response {
  const response = NextResponse.json(
    result.ok ? { ok: true, value: result.value ?? null } : result,
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
  if (request.method === "GET" && readCookie(request.headers, CSRF_COOKIE) === null) {
    response.cookies.set(CSRF_COOKIE, mintCsrfToken(), {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      secure: new URL(env.BASE_URL).protocol === "https:",
    });
  }
  return response;
}

export function createMailConnectionHttp(db: Db, deps: MailConnectionHttpDependencies = {}) {
  return async (request: Request): Promise<Response> => {
    const deadline = AbortSignal.timeout(deps.timeoutMs ?? HTTP_TIMEOUT_MS);
    const signal = AbortSignal.any([request.signal, deadline]);
    try {
      const pending = (async () => {
        signal.throwIfAborted();
        const path = /^\/api\/mail-connections\/(list|check|save|mutate)$/.exec(
          new URL(request.url).pathname,
        )?.[1];
        const write = request.method === "POST";
        if (request.method !== "GET" && !write)
          return json({ ok: false, error: "unsupported" }, 405, request);
        if (path === undefined || (request.method === "GET") !== (path === "list"))
          return json({ ok: false, error: "unsupported" }, 404, request);
        if (write && !workflowCsrf(request))
          return json({ ok: false, error: "permission" }, 403, request);
        const actor = await resolveMailboxHttpContext(db, request, signal, write, deps.rateLimit);
        if (!actor.ok)
          return json({ ok: false, error: actor.error.error }, actor.error.status, request);
        if (!write)
          return json(
            {
              ok: true,
              value: await (deps.list ?? listActorMailboxes)(db, actor.value.actorId, signal),
            },
            200,
            request,
          );
        const body = await readMailboxRequestBody(request, signal);
        if (!body.ok) return json(body, 400, request);
        const operation =
          path === "check"
            ? (deps.check ?? checkMailboxConnection)
            : path === "save"
              ? (deps.save ?? commitMailboxProof)
              : (deps.mutate ?? mutateMailboxConnection);
        const result = await operation(db, actor.value, body.value, signal);
        signal.throwIfAborted();
        return json(result, result.ok ? 200 : ERROR_STATUS[result.error], request);
      })();
      return await withMailboxRequestSignal(pending, signal);
    } catch (error) {
      if (request.signal.aborted) request.signal.throwIfAborted();
      if (deadline.aborted) return json({ ok: false, error: "network" }, 408, request);
      if (error instanceof Error && error.name === "AbortError") throw error;
      return json({ ok: false, error: "unknown" }, 500, request);
    }
  };
}
