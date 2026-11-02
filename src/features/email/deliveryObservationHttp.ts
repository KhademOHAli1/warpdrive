import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { readCookie } from "@/features/auth/better/sessionToken";
import { workflowCsrf } from "@/features/auth/better/workflowHttp";
import { CSRF_COOKIE, mintCsrfToken } from "@/features/auth/csrf";
import type { AuthUser } from "@/features/permissions/types";
import { hydrateActor } from "@/server/hydrateActor";
import { err, type Result } from "@/types/result";
import {
  listDeliveryReviewTargets,
  readAttemptDeliveryReports,
  readSourceDeliveryReports,
} from "./deliveryObservationReads";
import { reviewDeliveryReport } from "./deliveryObservationReview";
import type {
  DeliveryObservationError,
  DeliveryObservationView,
  DeliveryReviewState,
  DeliveryReviewTarget,
} from "./deliveryObservationTypes";
import { readMailboxRequestBody } from "./mailConnectionHttpBody";
import { withMailboxRequestSignal } from "./mailConnectionHttpSignal";
import type { MailboxActorSession } from "./mailConnectionSchemas";

const HTTP_TIMEOUT_MS = 20_000;
const ERROR_STATUS: Record<DeliveryObservationError, number> = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  permission: 403,
  rate_limit: 429,
  unknown: 500,
};
const querySchema = z.union([
  z.strictObject({ sourceMessageId: z.guid() }),
  z.strictObject({ attemptId: z.guid() }),
  z.strictObject({ reportId: z.guid() }),
]);
type HttpResult = Result<
  DeliveryObservationView[] | DeliveryReviewTarget[] | DeliveryReviewState,
  DeliveryObservationError
>;

interface DeliveryObservationHttpDependencies {
  review?: typeof reviewDeliveryReport;
  readSource?: typeof readSourceDeliveryReports;
  readAttempt?: typeof readAttemptDeliveryReports;
  listTargets?: typeof listDeliveryReviewTargets;
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

async function readReports(
  db: Db,
  request: Request,
  actor: AuthUser,
  deps: DeliveryObservationHttpDependencies,
  signal: AbortSignal,
): Promise<HttpResult> {
  const params = new URL(request.url).searchParams;
  // Counting entries before object conversion also rejects duplicate selectors.
  if (params.size !== 1) return err("invalid_input");
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return err("invalid_input");
  const query = parsed.data;
  if ("sourceMessageId" in query)
    return (deps.readSource ?? readSourceDeliveryReports)(
      db,
      { actor, sourceMessageId: query.sourceMessageId },
      signal,
    );
  if ("attemptId" in query)
    return (deps.readAttempt ?? readAttemptDeliveryReports)(
      db,
      { actor, attemptId: query.attemptId },
      signal,
    );
  return (deps.listTargets ?? listDeliveryReviewTargets)(
    db,
    { actor, reportId: query.reportId },
    signal,
  );
}

async function saveReview(
  db: Db,
  request: Request,
  context: MailboxActorSession,
  deps: DeliveryObservationHttpDependencies,
  signal: AbortSignal,
): Promise<HttpResult> {
  const body = await readMailboxRequestBody(request, signal);
  if (!body.ok) return body;
  return (deps.review ?? reviewDeliveryReport)(db, context, body.value, signal);
}

async function dispatch(
  db: Db,
  request: Request,
  deps: DeliveryObservationHttpDependencies,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  const write = request.method === "POST";
  if (request.method !== "GET" && !write) return json(err("invalid_input"), 405, request);
  if (new URL(request.url).pathname !== "/api/email/delivery-reports")
    return json(err("not_found"), 404, request);
  if (write && !workflowCsrf(request)) return json(err("permission"), 403, request);
  // Credential-management freshness is deliberately absent for this ordinary annotation.
  const session = await resolveWorkflowSession(db, request.headers, signal);
  const allowed = await (deps.rateLimit ?? enforceAuthRateLimit)(
    db,
    request.headers,
    write ? "/email/delivery-reports/review" : "/security/snapshot",
    session === null ? undefined : `delivery-reviews:${session.user.id}`,
    signal,
  );
  signal.throwIfAborted();
  if (!allowed) return json(err("rate_limit"), 429, request);
  if (session === null || session.user.invitedAt !== null)
    return json(err("permission"), 401, request);
  let result: HttpResult;
  if (write) {
    result = await saveReview(
      db,
      request,
      { actorId: session.user.id, sessionId: session.session.id },
      deps,
      signal,
    );
  } else {
    const actor = await hydrateActor(db, session.user.id, signal);
    if (actor === null) return json(err("permission"), 401, request);
    result = await readReports(db, request, actor, deps, signal);
  }
  signal.throwIfAborted();
  return json(result, result.ok ? 200 : ERROR_STATUS[result.error], request);
}

export function createDeliveryObservationHttp(
  db: Db,
  deps: DeliveryObservationHttpDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const deadline = AbortSignal.timeout(deps.timeoutMs ?? HTTP_TIMEOUT_MS);
    const signal = AbortSignal.any([request.signal, deadline]);
    try {
      signal.throwIfAborted();
      return await withMailboxRequestSignal(dispatch(db, request, deps, signal), signal);
    } catch (error) {
      if (request.signal.aborted) request.signal.throwIfAborted();
      if (deadline.aborted) return json(err("unknown"), 408, request);
      if (error instanceof Error && error.name === "AbortError") throw error;
      return json(err("unknown"), 500, request);
    }
  };
}
