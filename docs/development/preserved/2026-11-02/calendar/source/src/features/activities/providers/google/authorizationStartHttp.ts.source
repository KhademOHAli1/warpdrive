import { z } from "zod";
import type { Db } from "@/db/client";
import { workflowCsrf } from "@/features/auth/better/workflowHttp";
import { beginCalendarAuthorization } from "./accountAuthorization";
import {
  type CalendarOAuthHttpOptions,
  calendarHttpJson,
  calendarHttpOwner,
  setCalendarBrowserCookie,
} from "./authorizationHttp";
import { rethrowGoogleAbort } from "./errors";

const startSchema = z.strictObject({ accountId: z.uuid().optional() });
async function readStartBody(request: Request, signal: AbortSignal) {
  const text = await request.text();
  signal.throwIfAborted();
  if (text.length > 4096) return null;
  try {
    const parsed = startSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export async function handleCalendarAuthorizationStart(
  db: Db,
  request: Request,
  signal: AbortSignal,
  options: CalendarOAuthHttpOptions,
): Promise<Response> {
  signal.throwIfAborted();
  if (request.method !== "POST") {
    const response = calendarHttpJson({ ok: false, error: "method_not_allowed" }, 405);
    response.headers.set("Allow", "POST");
    return response;
  }
  if (!workflowCsrf(request)) return calendarHttpJson({ ok: false, error: "forbidden" }, 403);
  try {
    const ownerId = await calendarHttpOwner(db, request, signal);
    if (ownerId === null) return calendarHttpJson({ ok: false, error: "unauthorized" }, 401);
    if (options.config === null) return calendarHttpJson({ ok: false, error: "unavailable" }, 503);
    const body = await readStartBody(request, signal);
    if (body === null) return calendarHttpJson({ ok: false, error: "invalid_input" }, 400);
    const started = await beginCalendarAuthorization(db, ownerId, options.config, signal, body);
    if (!started.ok)
      return calendarHttpJson(
        { ok: false, error: started.error.kind },
        started.error.kind === "rate_limited" ? 429 : 400,
      );
    const response = calendarHttpJson({
      ok: true,
      data: {
        authorizationUrl: started.value.authorizationUrl,
        expiresAt: started.value.expiresAt,
      },
    });
    setCalendarBrowserCookie(
      response,
      started.value.state,
      started.value.browserNonce,
      options.baseUrl,
      new Date(started.value.expiresAt),
    );
    return response;
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return calendarHttpJson({ ok: false, error: "unavailable" }, 503);
  }
}
