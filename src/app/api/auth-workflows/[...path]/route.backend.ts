import type { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { INVITATION_COOKIE } from "@/features/auth/better/admission";
import { getBetterAuth } from "@/features/auth/better/instance";
import { authProviders } from "@/features/auth/better/providers";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { requestFactorRecovery } from "@/features/auth/better/recoveryRequest";
import { runSecurityAction } from "@/features/auth/better/securityActions";
import { readSecurityStatus } from "@/features/auth/better/status";
import { isWorkflowOrigin, workflowCsrf, workflowJson } from "@/features/auth/better/workflowHttp";
import { validateInvitation } from "@/features/auth/management/invitations";
import { dispatchAuthMail } from "@/features/auth/management/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.split("/").at(-1);
  const signal = AbortSignal.timeout(10_000);
  if (!(await enforceAuthRateLimit(db, request.headers, "/security/snapshot", undefined, signal)))
    return workflowJson({ ok: false, error: "RATE_LIMITED" }, 429);
  if (path === "providers")
    return workflowJson({ ok: true, data: authProviders(env) }, 200, request);
  if (path !== "status") return workflowJson({ ok: false, error: "NOT_FOUND" }, 404);
  const status = await readSecurityStatus(db, request.headers, signal);
  return status === null
    ? workflowJson({ ok: false, error: "SESSION_EXPIRED" }, 401, request)
    : workflowJson({ ok: true, data: status }, 200, request);
}

export async function POST(request: Request): Promise<Response> {
  if (!isWorkflowOrigin(request)) return workflowJson({ ok: false, error: "FORBIDDEN" }, 403);
  const path = new URL(request.url).pathname.split("/").at(-1);
  const signal = AbortSignal.timeout(15_000);
  if (!(await enforceAuthRateLimit(db, request.headers, "/workflow-write", undefined, signal)))
    return workflowJson({ ok: false, error: "RATE_LIMITED" }, 429);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return workflowJson({ ok: false, error: "INVALID_INPUT" }, 400);
  }
  if (path === "recovery-request") return recoveryRequest(request, body, signal);
  if (path === "invitation") return invitationRequest(request, body, signal);
  if (path === "security") return securityRequest(request, body, signal);
  return workflowJson({ ok: false, error: "NOT_FOUND" }, 404);
}

async function recoveryRequest(
  request: Request,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const input = z.strictObject({ email: z.email().max(255) }).safeParse(body);
  if (!input.success) return workflowJson({ ok: false, error: "INVALID_INPUT" }, 400);
  if (
    !(await enforceAuthRateLimit(
      db,
      request.headers,
      "/recovery-request",
      input.data.email.toLowerCase(),
      signal,
    ))
  )
    return workflowJson({ ok: false, error: "RATE_LIMITED" }, 429);
  await requestFactorRecovery(db, input.data.email, signal);
  if (env.AUTH_MAIL_TRANSPORT === "capture") await dispatchAuthMail(db, signal);
  return workflowJson({ ok: true, data: {} });
}

async function invitationRequest(
  request: Request,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const input = z.strictObject({ token: z.string().min(40).max(128) }).safeParse(body);
  if (!input.success) return workflowJson({ ok: false, error: "INVALID_INVITATION" }, 400);
  const valid = await validateInvitation(db, input.data.token, signal);
  if (!valid.ok) return workflowJson({ ok: false, error: "INVALID_INVITATION" }, 400);
  const response = workflowJson(
    {
      ok: true,
      data: {
        email: valid.value.email,
        name: valid.value.name,
        expiresAt: valid.value.expiresAt.toISOString(),
      },
    },
    200,
    request,
  );
  response.cookies.set(INVITATION_COOKIE, input.data.token, {
    httpOnly: true,
    secure: new URL(env.BASE_URL).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: Math.min(1800, Math.floor((valid.value.expiresAt.getTime() - Date.now()) / 1000)),
  });
  return response;
}

async function securityRequest(
  request: Request,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  if (!workflowCsrf(request)) return workflowJson({ ok: false, error: "FORBIDDEN" }, 403);
  const result = await runSecurityAction(db, getBetterAuth(), request.headers, body, signal);
  if (env.AUTH_MAIL_TRANSPORT === "capture") await dispatchAuthMail(db, signal);
  const response = workflowJson(result, result.ok ? 200 : 403);
  if (
    result.ok &&
    typeof body === "object" &&
    body !== null &&
    "action" in body &&
    body.action === "revokeAll"
  )
    (response as NextResponse).cookies.set("wd_sid", "", { path: "/", maxAge: 0, httpOnly: true });
  return response;
}
