import { z } from "zod";
import type { Db } from "@/db/client";
import { readCookie } from "@/features/auth/better/sessionToken";
import { finishCalendarAuthorization } from "./accountAuthorization";
import { cancelCalendarAuthorization } from "./accountAuthorizationCancel";
import { calendarOpaqueTokenSchema } from "./authorization";
import {
  type CalendarOAuthHttpOptions,
  calendarBrowserCookieName,
  calendarCallbackRedirect,
  calendarHttpJson,
  calendarHttpOwner,
} from "./authorizationHttp";
import type { GoogleTransport } from "./contracts";
import { rethrowGoogleAbort } from "./errors";

const callbackSchema = z
  .object({
    state: calendarOpaqueTokenSchema,
    code: z.string().min(1).max(4096).optional(),
    error: z.string().min(1).max(255).optional(),
  })
  .refine((value) => (value.code === undefined) !== (value.error === undefined));
export async function handleCalendarAuthorizationCallback(
  db: Db,
  request: Request,
  signal: AbortSignal,
  options: CalendarOAuthHttpOptions & { transport?: GoogleTransport },
): Promise<Response> {
  signal.throwIfAborted();
  if (request.method !== "GET") {
    const response = calendarHttpJson({ ok: false, error: "method_not_allowed" }, 405);
    response.headers.set("Allow", "GET");
    return response;
  }
  const params = new URL(request.url).searchParams;
  if (["state", "code", "error"].some((name) => params.getAll(name).length > 1))
    return calendarCallbackRedirect(options.baseUrl, "error");
  const input = callbackSchema.safeParse({
    state: params.get("state"),
    code: params.get("code") ?? undefined,
    error: params.get("error") ?? undefined,
  });
  if (!input.success) return calendarCallbackRedirect(options.baseUrl, "error");
  const redirect = (status: Parameters<typeof calendarCallbackRedirect>[1]) =>
    calendarCallbackRedirect(options.baseUrl, status, input.data.state);
  try {
    const ownerId = await calendarHttpOwner(db, request, signal);
    if (ownerId === null) return redirect("signed_out");
    if (options.config === null) return redirect("unavailable");
    const nonce = calendarOpaqueTokenSchema.safeParse(
      readCookie(request.headers, calendarBrowserCookieName(input.data.state)),
    );
    if (!nonce.success) return redirect("error");
    const binding = { state: input.data.state, browserNonce: nonce.data };
    if (input.data.error !== undefined) {
      const cancelled = await cancelCalendarAuthorization(
        db,
        ownerId,
        options.config,
        binding,
        signal,
      );
      return redirect(cancelled.ok && input.data.error === "access_denied" ? "denied" : "error");
    }
    if (input.data.code === undefined) return redirect("error");
    const finished = await finishCalendarAuthorization(
      db,
      ownerId,
      options.config,
      { ...binding, code: input.data.code },
      signal,
      { transport: options.transport },
    );
    return redirect(finished.ok ? "connected" : "error");
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return redirect("error");
  }
}
