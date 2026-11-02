import type { Db } from "@/db/client";
import { err, type Result } from "@/types/result";
import { calendarCallbackInput, consumeCalendarAuthorization } from "./accountAuthorizationState";
import { bindCalendarGrant } from "./accountBind";
import {
  type CalendarAuthorizationError,
  type CalendarOAuthConfig,
  readCalendarOAuthConfig,
} from "./authorizationConfig";
import type { GoogleTransport } from "./contracts";
import { exchangeCalendarCode, fetchCalendarIdentity } from "./tokenClient";
import { googleFetch } from "./transport";

export type { CalendarAuthorizationOptions, CalendarOAuthStart } from "./accountAuthorizationState";
export { beginCalendarAuthorization } from "./accountAuthorizationState";
export interface CalendarFinishOptions {
  transport?: GoogleTransport;
  now?: () => Date;
  requireSameEmail?: boolean;
  allowedDomain?: string;
}
export async function finishCalendarAuthorization(
  db: Db,
  userId: string,
  config: CalendarOAuthConfig,
  raw: { state: string; browserNonce: string; code: string },
  signal: AbortSignal,
  options: CalendarFinishOptions = {},
): Promise<Result<{ accountId: string }, CalendarAuthorizationError>> {
  signal.throwIfAborted();
  const validated = readCalendarOAuthConfig(config);
  if (!validated.ok) return validated;
  const parsed = calendarCallbackInput.safeParse(raw);
  if (!parsed.success) return err({ kind: "invalid_input" });
  const now = options.now ?? (() => new Date());
  const consumed = await consumeCalendarAuthorization(
    db,
    userId,
    validated.value,
    parsed.data,
    signal,
    now,
  );
  if (!consumed.ok) return consumed;
  const transport = options.transport ?? googleFetch;
  const tokens = await exchangeCalendarCode(
    validated.value,
    { code: parsed.data.code, codeVerifier: consumed.value.codeVerifier, signal },
    transport,
  );
  if (!tokens.ok) return tokens;
  const identity = await fetchCalendarIdentity(tokens.value.accessToken, signal, transport);
  if (!identity.ok) return identity;
  return bindCalendarGrant(
    db,
    consumed.value,
    validated.value,
    identity.value,
    tokens.value,
    { requireSameEmail: options.requireSameEmail, allowedDomain: options.allowedDomain },
    signal,
    now,
  );
}
