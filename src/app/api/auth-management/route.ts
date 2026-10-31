import { env } from "@/config/env";
import { db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { workflowCsrf } from "@/features/auth/better/workflowHttp";
import { runManagementCommand } from "@/features/auth/management/commands";
import { readManagementSnapshot } from "@/features/auth/management/directory";
import { dispatchAuthMail } from "@/features/auth/management/mail";
import { managementActionInput, managementQueryInput } from "@/features/auth/management/schemas";
import { hydrateActor } from "@/server/hydrateActor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  if (!(await enforceAuthRateLimit(db, request.headers, "/security/snapshot", undefined, signal)))
    return response({ ok: false, error: "rate_limited" }, 429);
  const session = await resolveWorkflowSession(db, request.headers, signal);
  if (session === null) return response({ ok: false, error: "unauthorized" }, 401);
  const actor = await hydrateActor(db, session.user.id, signal);
  if (actor === null) return response({ ok: false, error: "forbidden" }, 403);
  const params = new URL(request.url).searchParams;
  const parsed = managementQueryInput.safeParse({
    q: params.get("q") ?? "",
    status: params.get("status") ?? "all",
    page: params.get("page") ?? 1,
    auditQ: params.get("auditQ") ?? "",
    auditOutcome: params.get("auditOutcome") ?? "all",
    auditPage: params.get("auditPage") ?? 1,
  });
  if (!parsed.success) return response({ ok: false, error: "invalid_input" }, 400);
  const result = await readManagementSnapshot(db, actor, parsed.data, signal);
  return result.ok
    ? response({ ok: true, data: result.value })
    : response({ ok: false, error: result.error }, 403);
}

export async function POST(request: Request): Promise<Response> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  if (!workflowCsrf(request)) return response({ ok: false, error: "forbidden" }, 403);
  if (!(await enforceAuthRateLimit(db, request.headers, "/security/management", undefined, signal)))
    return response({ ok: false, error: "rate_limited" }, 429);
  const session = await resolveWorkflowSession(db, request.headers, signal, { requireFresh: true });
  if (session === null) return response({ ok: false, error: "fresh_auth_required" }, 401);
  const actor = await hydrateActor(db, session.user.id, signal);
  if (actor === null) return response({ ok: false, error: "forbidden" }, 403);
  const rawText = await request.text();
  if (rawText.length > 16384) return response({ ok: false, error: "invalid_input" }, 400);
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return response({ ok: false, error: "invalid_input" }, 400);
  }
  const parsed = managementActionInput.safeParse(raw);
  if (!parsed.success) return response({ ok: false, error: "invalid_input" }, 400);
  const result = await runManagementCommand(db, actor, parsed.data, signal);
  if (!result.ok)
    return response({ ok: false, error: result.error }, result.error === "forbidden" ? 403 : 400);
  // Local capture and SMTP use the same durable outbox; failed delivery is visible and retryable.
  if (env.AUTH_MAIL_TRANSPORT === "capture") await dispatchAuthMail(db, signal);
  return response({ ok: true, data: result.value });
}
