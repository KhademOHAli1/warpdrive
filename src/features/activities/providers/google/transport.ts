import type { z } from "zod";
import { err, ok } from "@/types/result";
import type { GoogleCalendarGrant, GoogleResult, GoogleTransport } from "./contracts";
import { googleResponseError, rethrowGoogleAbort } from "./errors";
import { googleRequestPath } from "./path";

const API = "https://www.googleapis.com/calendar/v3";
export const googleFetch: GoogleTransport = (url, init) =>
  fetch(url, { ...init, signal: init.signal });
export interface GoogleRequest {
  path: readonly string[];
  query?: URLSearchParams;
  method?: string;
  body?: object;
  etag?: string;
}
export function calendarTransport(grant: GoogleCalendarGrant, transport: GoogleTransport) {
  return async function request<T>(
    input: GoogleRequest,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<GoogleResult<T>> {
    signal.throwIfAborted();
    const path = googleRequestPath(input.path);
    if (!path.ok) return path;
    const headers: Record<string, string> = { Authorization: `Bearer ${grant.accessToken}` };
    if (input.body !== undefined) headers["Content-Type"] = "application/json";
    if (input.etag !== undefined) headers["If-Match"] = input.etag;
    let response: Response;
    try {
      response = await transport(
        `${API}${path.value}${input.query !== undefined ? `?${input.query.toString()}` : ""}`,
        {
          method: input.method ?? "GET",
          headers,
          signal,
          ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
        },
      );
    } catch (error) {
      rethrowGoogleAbort(error, signal);
      return err({ kind: "network" });
    }
    signal.throwIfAborted();
    if (!response.ok) return err(await googleResponseError(response, signal));
    let body: unknown;
    try {
      body = response.status === 204 ? null : await response.json();
    } catch (error) {
      rethrowGoogleAbort(error, signal);
      return err({ kind: "invalid_response" });
    }
    signal.throwIfAborted();
    const parsed = schema.safeParse(body);
    return parsed.success ? ok(parsed.data) : err({ kind: "invalid_response" });
  };
}
export type CalendarRequest = ReturnType<typeof calendarTransport>;
