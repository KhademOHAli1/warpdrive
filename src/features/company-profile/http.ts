import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { readCookie } from "@/features/auth/better/sessionToken";
import { CSRF_COOKIE, mintCsrfToken, validateCsrf } from "@/features/auth/csrf";
import { err, ok, type Result } from "@/types/result";
import type { CompanyFailure, CompanyResponse } from "./contracts";
import { companyFailure } from "./policy";

export function companyJson<T>(
  body: CompanyResponse<T>,
  status = 200,
  request?: Request,
): Response {
  const response = NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
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
export function companyCsrf(request: Request, multipart = false) {
  const content = request.headers.get("content-type")?.split(";")[0]?.trim();
  return (
    request.headers.get("origin") === new URL(env.BASE_URL).origin &&
    content === (multipart ? "multipart/form-data" : "application/json") &&
    validateCsrf({
      cookieToken: readCookie(request.headers, CSRF_COOKIE),
      headerToken: request.headers.get("x-csrf-token"),
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    }).ok
  );
}
export async function companyBody(
  request: Request,
  max: number,
  signal: AbortSignal,
): Promise<Result<Uint8Array, CompanyFailure>> {
  signal.throwIfAborted();
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max))
    return err(companyFailure("invalid_input"));
  if (!request.body) return err(companyFailure("invalid_input"));
  const reader = request.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.length;
      if (length > max) {
        // Do not let upstream cancellation keep the authority transaction open.
        void reader.cancel().catch(() => undefined);
        return err(companyFailure("invalid_input"));
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return ok(bytes);
  } catch {
    signal.throwIfAborted();
    return err(companyFailure("invalid_input"));
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
export function companyResult<T>(result: Result<T, CompanyFailure>, request?: Request): Response {
  if (result.ok) return companyJson({ ok: true, data: result.value }, 200, request);
  const status = (
    {
      unauthorized: 401,
      fresh_auth_required: 401,
      forbidden: 403,
      invalid_input: 400,
      conflict: 409,
      not_found: 404,
      storage_unavailable: 503,
      asset_invalid: 400,
      provider_unavailable: 503,
      replay_conflict: 409,
      write_failed: 503,
      rate_limited: 429,
    } as const
  )[result.error.code];
  return companyJson({ ok: false, error: result.error }, status, request);
}
