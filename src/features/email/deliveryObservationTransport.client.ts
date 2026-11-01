import { z } from "zod";
import { err, type Result } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";
import { deliveryObservationReviewInput } from "./deliveryObservationReviewInput";
import {
  deliveryObservationErrorSchema,
  deliveryObservationReportsSchema,
  deliveryObservationTargetsSchema,
  savedDeliveryReviewSchema,
} from "./deliveryObservationTransport.schemas";
import type {
  DeliveryObservationError,
  DeliveryObservationView,
  DeliveryReviewState,
  DeliveryReviewTarget,
} from "./deliveryObservationTypes";
import { withMailboxRequestSignal } from "./mailConnectionHttpSignal";

const ENDPOINT = "/api/email/delivery-reports";
const reads = z.union([
  z.strictObject({ accountId: z.guid(), sourceMessageId: z.guid() }),
  z.strictObject({ accountId: z.guid(), attemptId: z.guid() }),
]);
const targets = z.strictObject({ accountId: z.guid(), reportId: z.guid() });
const reviews = z.strictObject({ accountId: z.guid(), input: deliveryObservationReviewInput });

function responseFailure(status: number): DeliveryObservationError {
  if (status === 401 || status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  return status === 400 ? "invalid_input" : "unknown";
}

// Start work only after the pre-abort check, and attach observers before invoking it.
// A late fetch/JSON result must remain observed even after the caller has cancelled.
function wait<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const pending = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return work();
  });
  return withMailboxRequestSignal(pending, signal);
}

async function request<T>(
  query: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  body?: unknown,
): Promise<Result<T, DeliveryObservationError>> {
  signal.throwIfAborted();
  const csrf = body === undefined ? null : readCsrfToken();
  if (body !== undefined && (csrf === null || csrf === "")) return err("permission");
  let response: Response;
  try {
    response = await wait(
      () =>
        fetch(`${ENDPOINT}${query}`, {
          method: body === undefined ? "GET" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal,
          headers:
            body === undefined
              ? {}
              : { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err("unknown");
  }
  signal.throwIfAborted();
  let raw: unknown;
  try {
    raw = await wait(() => response.json(), signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err(responseFailure(response.status));
  }
  signal.throwIfAborted();
  const parsed = z
    .discriminatedUnion("ok", [
      z.strictObject({ ok: z.literal(true), value: schema }),
      z.strictObject({ ok: z.literal(false), error: deliveryObservationErrorSchema }),
    ])
    .safeParse(raw);
  if (!response.ok) return err(responseFailure(response.status));
  if (!parsed.success || !parsed.data.ok) return err("unknown");
  return parsed.data;
}

export async function readDeliveryObservationReports(
  input: unknown,
  signal: AbortSignal,
): Promise<Result<DeliveryObservationView[], DeliveryObservationError>> {
  signal.throwIfAborted();
  const parsed = reads.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const scope = parsed.data;
  const selector =
    "sourceMessageId" in scope
      ? new URLSearchParams({ sourceMessageId: scope.sourceMessageId })
      : new URLSearchParams({ attemptId: scope.attemptId });
  const result = await request(`?${selector}`, deliveryObservationReportsSchema, signal);
  signal.throwIfAborted();
  if (!result.ok) return result;
  const matches = result.value.every((report) =>
    "sourceMessageId" in scope
      ? report.sourceMessageId === scope.sourceMessageId
      : report.recipients.every(
          (recipient) =>
            recipient.review.decision === "associated" &&
            recipient.review.target?.attemptId === scope.attemptId,
        ),
  );
  return matches ? result : err("unknown");
}

export async function listDeliveryObservationReviewTargets(
  input: unknown,
  signal: AbortSignal,
): Promise<Result<DeliveryReviewTarget[], DeliveryObservationError>> {
  signal.throwIfAborted();
  const parsed = targets.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  return request(
    `?${new URLSearchParams({ reportId: parsed.data.reportId })}`,
    deliveryObservationTargetsSchema,
    signal,
  );
}

export async function reviewDeliveryObservation(
  input: unknown,
  signal: AbortSignal,
): Promise<Result<DeliveryReviewState, DeliveryObservationError>> {
  signal.throwIfAborted();
  const parsed = reviews.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const review = parsed.data.input;
  const result = await request("", savedDeliveryReviewSchema, signal, review);
  signal.throwIfAborted();
  if (!result.ok) return result;
  const saved = result.value;
  const matches =
    saved.revision === review.expectedRevision + 1 &&
    (review.decision === "dismiss"
      ? saved.decision === "dismissed" && saved.target === null
      : saved.decision === "associated" &&
        saved.target?.attemptId === review.target.attemptId &&
        saved.target.recipient === review.target.recipient);
  return matches ? result : err("unknown");
}
