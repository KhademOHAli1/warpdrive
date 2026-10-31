import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { sessions } from "@/db/schema";
import { CSRF_COOKIE, validateCsrf } from "@/features/auth/csrf";
import {
  AUTH_SESSION_COOKIE,
  hashSessionCredential,
  readCookie,
  sessionTokenFromCookie,
} from "./sessionToken";
import { workflowJson } from "./workflowHttp";

function clearedLogoutResponse(request: Request): NextResponse {
  const response = NextResponse.redirect(new URL("/login", env.BASE_URL), 303);
  response.headers.set("Cache-Control", "no-store");
  const names = new Set([
    AUTH_SESSION_COOKIE,
    CSRF_COOKIE,
    "wd_invite",
    "better-auth.session_data",
    "better-auth.account_data",
    "better-auth.dont_remember",
    "better-auth.two_factor",
    "better-auth.trust_device",
    "better-auth.better-auth-passkey",
  ]);
  for (const cookie of (request.headers.get("cookie") ?? "").split(";")) {
    const name = cookie.slice(0, cookie.indexOf("=")).trim();
    // Clear native chunks/state cookies too, without touching unrelated application cookies.
    if (/^(?:__Secure-|__Host-)?better-auth\.[A-Za-z0-9_.-]+$/.test(name)) names.add(name);
  }
  for (const name of names)
    response.cookies.set(name, "", {
      httpOnly: name !== CSRF_COOKIE,
      secure: new URL(env.BASE_URL).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  return response;
}

async function hasLogoutCsrf(request: Request, signal: AbortSignal): Promise<boolean> {
  if (request.headers.get("origin") !== new URL(env.BASE_URL).origin) return false;
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();
  if (contentType !== "application/x-www-form-urlencoded" && contentType !== "multipart/form-data")
    return false;
  signal.throwIfAborted();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return false;
  }
  signal.throwIfAborted();
  const csrfToken = form.get("csrfToken");
  if (typeof csrfToken !== "string" || csrfToken.length === 0) return false;
  return validateCsrf({
    cookieToken: readCookie(request.headers, CSRF_COOKIE),
    headerToken: csrfToken,
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  }).ok;
}

export async function logoutCurrentRequest(
  db: Db,
  request: Request,
  signal: AbortSignal,
): Promise<NextResponse> {
  if (request.method !== "POST") {
    const response = workflowJson({ ok: false, error: "method_not_allowed" }, 405);
    response.headers.set("Allow", "POST");
    return response;
  }
  if (!(await hasLogoutCsrf(request, signal)))
    return workflowJson({ ok: false, error: "csrf_invalid" }, 403);
  const cookie = readCookie(request.headers, AUTH_SESSION_COOKIE);
  const raw = cookie === null ? null : sessionTokenFromCookie(cookie);
  if (raw !== null) {
    signal.throwIfAborted();
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, hashSessionCredential(raw)), isNull(sessions.revokedAt)));
    signal.throwIfAborted();
  }
  return clearedLogoutResponse(request);
}
