import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { CSRF_COOKIE, mintCsrfToken, validateCsrf } from "@/features/auth/csrf";
import type { WorkflowResponse } from "./contracts";
import { readCookie } from "./sessionToken";

export function isWorkflowOrigin(request: Request): boolean {
  const expected = new URL(env.BASE_URL).origin;
  return (
    request.headers.get("origin") === expected &&
    request.headers.get("content-type")?.split(";")[0]?.trim() === "application/json" &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}

export function workflowCsrf(request: Request): boolean {
  return (
    isWorkflowOrigin(request) &&
    validateCsrf({
      cookieToken: readCookie(request.headers, CSRF_COOKIE),
      headerToken: request.headers.get("x-csrf-token"),
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    }).ok
  );
}

export function workflowJson<T>(body: WorkflowResponse<T>, status = 200, request?: Request) {
  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  if (request && readCookie(request.headers, CSRF_COOKIE) === null)
    response.cookies.set(CSRF_COOKIE, mintCsrfToken(), {
      secure: new URL(env.BASE_URL).protocol === "https:",
      httpOnly: false,
      sameSite: "lax",
      path: "/",
    });
  return response;
}
