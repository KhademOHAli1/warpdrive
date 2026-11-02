import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import type { CalendarAuthorizationError } from "./authorizationConfig";
import type { GoogleTransport } from "./contracts";
import { rethrowGoogleAbort } from "./errors";

const tokenErrorSchema = z.object({ error: z.string() });
function httpErrorKind(status: number): CalendarAuthorizationError["kind"] {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "provider_unavailable" : "provider_rejected";
}
async function tokenHttpError(
  response: Response,
  signal: AbortSignal,
): Promise<CalendarAuthorizationError> {
  let kind = httpErrorKind(response.status);
  if (response.status === 400) {
    try {
      const parsed = tokenErrorSchema.safeParse(await response.json());
      signal.throwIfAborted();
      if (parsed.success && parsed.data.error === "invalid_grant") kind = "unauthorized";
    } catch (error) {
      rethrowGoogleAbort(error, signal);
    }
  }
  return { kind, status: response.status };
}
export async function calendarOAuthRequest<T>(
  transport: GoogleTransport,
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<Result<T, CalendarAuthorizationError>> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await transport(url, { ...init, redirect: "error", signal });
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return err({ kind: "network" });
  }
  signal.throwIfAborted();
  if (!response.ok) return err(await tokenHttpError(response, signal));
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return err({ kind: "invalid_response" });
  }
  signal.throwIfAborted();
  const parsed = schema.safeParse(body);
  return parsed.success ? ok(parsed.data) : err({ kind: "invalid_response" });
}
