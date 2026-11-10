import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, type Result } from "@/types/result";
import { withCalendarActor } from "../../calendarNativeAuthority";
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
  nativeSession?: NativeSessionRef;
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
  const bind = (tx: Db) =>
    bindCalendarGrant(
      tx,
      consumed.value,
      validated.value,
      identity.value,
      tokens.value,
      { requireSameEmail: options.requireSameEmail, allowedDomain: options.allowedDomain },
      signal,
      now,
    );
  if (options.nativeSession === undefined) return bind(db);
  // Provider HTTP happens outside the native authority fence. Only the short
  // final binding transaction holds it, so logout can revoke an in-flight exchange.
  const failure: { value: CalendarAuthorizationError | null } = { value: null };
  const bound = await withCalendarActor(db, options.nativeSession, userId, signal, async (tx) => {
    const result = await bind(tx);
    if (result.ok) return result;
    failure.value = result.error;
    return err(
      new AppError(ERROR_IDS.CALENDAR_ACCOUNT_INPUT_INVALID, "Calendar grant binding denied"),
    );
  });
  return bound.ok ? bound : err(failure.value ?? { kind: "invalid_state" });
}
