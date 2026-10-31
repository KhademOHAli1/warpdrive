import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { err, ok, type Result } from "@/types/result";
import { buildAuthUrl } from "./oauth";
import {
  createGmailOAuthState,
  type GmailOAuthError,
  resolveGmailOAuthSession,
} from "./oauthState";

export async function startGmailOAuth(
  db: Db,
  headers: Headers,
  signal: AbortSignal,
): Promise<Result<{ url: string; state: string }, GmailOAuthError | "rate_limit">> {
  signal.throwIfAborted();
  if (
    headers.get("origin") !== new URL(env.BASE_URL).origin ||
    headers.get("sec-fetch-site") === "cross-site"
  )
    return err("permission");
  const native = await resolveGmailOAuthSession(db, headers, signal);
  if (!native.ok) return native;
  if (
    !(await enforceAuthRateLimit(
      db,
      headers,
      "/mail-connections/write",
      `mail-connections:${native.value.user.id}`,
      signal,
    ))
  )
    return err("rate_limit");
  const grant = await createGmailOAuthState(
    db,
    { actorId: native.value.user.id, sessionId: native.value.session.id },
    signal,
  );
  if (!grant.ok) return grant;
  return ok({
    state: grant.value.state,
    url: buildAuthUrl({
      userId: native.value.user.id,
      state: grant.value.state,
      codeChallenge: grant.value.codeChallenge,
    }),
  });
}
