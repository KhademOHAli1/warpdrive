import { z } from "zod";
import { err } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";
import { withMailboxRequestSignal } from "./mailConnectionHttpSignal";
import {
  privateIntakeReadInputSchema,
  privateIntakeReviewInputSchema,
  privateIntakeSummarySchema,
} from "./privateIntakeSchemas";
import type { PrivateIntakeReviewError, PrivateIntakeReviewResult } from "./privateIntakeTypes";

const ENDPOINT = "/api/email/private-intake";
const responseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: privateIntakeSummarySchema }),
  z.strictObject({
    ok: z.literal(false),
    error: z.enum([
      "not_found",
      "conflict",
      "forbidden",
      "unavailable",
      "invalid_input",
      "rate_limit",
    ]),
  }),
]);

function responseFailure(status: number): PrivateIntakeReviewError {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return status === 409 ? "conflict" : "unavailable";
}

// Observe work before invoking it, including late rejections after caller cancellation.
function wait<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const pending = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return work();
  });
  return withMailboxRequestSignal(pending, signal);
}

async function request(
  query: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<PrivateIntakeReviewResult> {
  signal.throwIfAborted();
  const csrf = body === undefined ? null : readCsrfToken();
  if (body !== undefined && (csrf === null || csrf === "")) return err("forbidden");
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
    return err("unavailable");
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
  const parsed = responseSchema.safeParse(raw);
  if (!response.ok) return err(responseFailure(response.status));
  if (!parsed.success || !parsed.data.ok) return err("unavailable");
  return parsed.data;
}

export async function readPrivateIntakeSummary(
  input: unknown,
  signal: AbortSignal,
): Promise<PrivateIntakeReviewResult> {
  signal.throwIfAborted();
  const parsed = privateIntakeReadInputSchema.safeParse(input);
  if (!parsed.success) return err("unavailable");
  const result = await request(`?${new URLSearchParams(parsed.data)}`, signal);
  signal.throwIfAborted();
  if (!result.ok) return result;
  return result.value.id === parsed.data.intakeId ? result : err("unavailable");
}

export async function reviewPrivateIntakeSummary(
  input: unknown,
  signal: AbortSignal,
): Promise<PrivateIntakeReviewResult> {
  signal.throwIfAborted();
  const parsed = privateIntakeReviewInputSchema.safeParse(input);
  if (!parsed.success) return err("unavailable");
  const result = await request("", signal, parsed.data);
  signal.throwIfAborted();
  if (!result.ok) return result;
  const saved = result.value;
  return saved.id === parsed.data.intakeId &&
    saved.revision === parsed.data.expectedRevision + 1 &&
    saved.decision === parsed.data.decision
    ? result
    : err("unavailable");
}
