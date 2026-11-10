import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";
import { rethrowGoogleAbort } from "./errors";

const authorizationUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.origin === "https://accounts.google.com" &&
    url.pathname === "/o/oauth2/v2/auth" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
});
const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.object({ authorizationUrl }) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export async function requestGoogleCalendarConnection(
  signal: AbortSignal,
  accountId?: string,
): Promise<Result<string, "unavailable">> {
  signal.throwIfAborted();
  try {
    const response = await fetch("/api/calendar/google/oauth/start", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": readCsrfToken() ?? "" },
      body: JSON.stringify(accountId === undefined ? {} : { accountId }),
      signal,
    });
    const parsed = responseSchema.safeParse(await response.json());
    signal.throwIfAborted();
    return response.ok && parsed.success && parsed.data.ok
      ? ok(parsed.data.data.authorizationUrl)
      : err("unavailable");
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return err("unavailable");
  }
}
