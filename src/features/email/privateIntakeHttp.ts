import { NextResponse } from "next/server";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { readCookie } from "@/features/auth/better/sessionToken";
import { workflowCsrf } from "@/features/auth/better/workflowHttp";
import { CSRF_COOKIE, mintCsrfToken } from "@/features/auth/csrf";
import { err, type Result } from "@/types/result";
import { readMailboxRequestBody } from "./mailConnectionHttpBody";
import { withMailboxRequestSignal } from "./mailConnectionHttpSignal";
import type { MailboxActorSession } from "./mailConnectionSchemas";
import { readPrivateIntake, reviewPrivateIntake } from "./privateIntakeReview";
import {
  privateIntakeReadInputSchema,
  privateIntakeReviewInputSchema,
} from "./privateIntakeSchemas";
import type { PrivateIntakeReviewError, PrivateIntakeSummary } from "./privateIntakeTypes";

const HTTP_PATH = "/api/email/private-intake";
const HTTP_TIMEOUT_MS = 20_000;
type HttpError = PrivateIntakeReviewError | "invalid_input" | "rate_limit";
type HttpResult = Result<PrivateIntakeSummary, HttpError>;
const ERROR_STATUS: Record<HttpError, number> = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unavailable: 500,
  rate_limit: 429,
};

interface PrivateIntakeHttpDependencies {
  read?: typeof readPrivateIntake;
  review?: typeof reviewPrivateIntake;
  rateLimit?: typeof enforceAuthRateLimit;
  timeoutMs?: number;
}

function json(result: HttpResult, status: number, request: Request): Response {
  const response = NextResponse.json(result, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
    },
  });
  if (request.method === "GET" && readCookie(request.headers, CSRF_COOKIE) === null)
    response.cookies.set(CSRF_COOKIE, mintCsrfToken(), {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      secure: new URL(env.BASE_URL).protocol === "https:",
    });
  return response;
}

async function readSummary(
  db: Db,
  request: Request,
  context: MailboxActorSession,
  deps: PrivateIntakeHttpDependencies,
  signal: AbortSignal,
): Promise<HttpResult> {
  const params = new URL(request.url).searchParams;
  // Check entries before conversion so repeated names cannot hide a duplicate selector.
  if (params.size !== 2) return err("invalid_input");
  const parsed = privateIntakeReadInputSchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return err("invalid_input");
  return (deps.read ?? readPrivateIntake)(db, context, parsed.data, signal);
}

async function saveReview(
  db: Db,
  request: Request,
  context: MailboxActorSession,
  deps: PrivateIntakeHttpDependencies,
  signal: AbortSignal,
): Promise<HttpResult> {
  const body = await readMailboxRequestBody(request, signal);
  if (!body.ok) return body;
  const parsed = privateIntakeReviewInputSchema.safeParse(body.value);
  if (!parsed.success) return err("invalid_input");
  return (deps.review ?? reviewPrivateIntake)(db, context, parsed.data, signal);
}

async function dispatch(
  db: Db,
  request: Request,
  deps: PrivateIntakeHttpDependencies,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  const write = request.method === "POST";
  if (request.method !== "GET" && !write) return json(err("invalid_input"), 405, request);
  if (new URL(request.url).pathname !== HTTP_PATH) return json(err("not_found"), 404, request);
  if (write && !workflowCsrf(request)) return json(err("forbidden"), 403, request);
  // Local review uses an ordinary full session, including its native policy and commit fences.
  const session = await resolveWorkflowSession(db, request.headers, signal);
  const allowed = await (deps.rateLimit ?? enforceAuthRateLimit)(
    db,
    request.headers,
    write ? "/email/private-intake/review" : "/security/snapshot",
    session === null ? undefined : `private-intake:${session.user.id}`,
    signal,
  );
  signal.throwIfAborted();
  if (!allowed) return json(err("rate_limit"), 429, request);
  if (session === null || session.user.invitedAt !== null)
    return json(err("forbidden"), 401, request);
  const context = { actorId: session.user.id, sessionId: session.session.id };
  const result = write
    ? await saveReview(db, request, context, deps, signal)
    : await readSummary(db, request, context, deps, signal);
  signal.throwIfAborted();
  return json(result, result.ok ? 200 : ERROR_STATUS[result.error], request);
}

export function createPrivateIntakeHttp(
  db: Db,
  deps: PrivateIntakeHttpDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const deadline = AbortSignal.timeout(deps.timeoutMs ?? HTTP_TIMEOUT_MS);
    const signal = AbortSignal.any([request.signal, deadline]);
    try {
      // Dispatch is deliberately created only after this check, including its rate/session work.
      signal.throwIfAborted();
      return await withMailboxRequestSignal(dispatch(db, request, deps, signal), signal);
    } catch (error) {
      if (request.signal.aborted) request.signal.throwIfAborted();
      if (deadline.aborted) return json(err("unavailable"), 408, request);
      if (error instanceof Error && error.name === "AbortError") throw error;
      return json(err("unavailable"), 500, request);
    }
  };
}
