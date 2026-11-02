import { z } from "zod";
import type { GoogleCalendarError, GoogleCalendarErrorKind } from "./contracts";

const retryableReasons = new Set(["userRateLimitExceeded", "rateLimitExceeded"]);
const providerReasonsSchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })) }),
});
const MAX_RETRY_AFTER_SECONDS = 86_400;
function httpKind(status: number): GoogleCalendarErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
  if (status === 409 || status === 412) return "conflict";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "provider_unavailable" : "provider_rejected";
}
function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) ? Math.min(seconds, MAX_RETRY_AFTER_SECONDS) : undefined;
}
export function rethrowGoogleAbort(error: unknown, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (error instanceof Error && error.name === "AbortError") throw error;
}
async function forbiddenKind(
  response: Response,
  signal: AbortSignal,
): Promise<GoogleCalendarErrorKind> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return "forbidden";
  }
  signal.throwIfAborted();
  // Keep only allowlisted machine reasons. Provider messages may contain private data.
  const parsed = providerReasonsSchema.safeParse(body);
  return parsed.success &&
    parsed.data.error.errors.some((error) => retryableReasons.has(error.reason))
    ? "rate_limited"
    : "forbidden";
}
export async function googleResponseError(
  response: Response,
  signal: AbortSignal,
): Promise<GoogleCalendarError> {
  signal.throwIfAborted();
  const kind =
    response.status === 403 ? await forbiddenKind(response, signal) : httpKind(response.status);
  const retryAfter = retryAfterSeconds(response);
  return {
    kind,
    status: response.status,
    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
  };
}
