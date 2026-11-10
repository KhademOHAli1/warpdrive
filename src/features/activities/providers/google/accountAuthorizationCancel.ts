import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { calendarOAuthAttempts } from "@/db/schema/calendarProviderAccounts";
import { err, ok, type Result } from "@/types/result";
import { activeCalendarOwner } from "./accountAccess";
import { calendarOpaqueTokenSchema, hashCalendarOAuthToken } from "./authorization";
import type { CalendarAuthorizationError, CalendarOAuthConfig } from "./authorizationConfig";

const inputSchema = z.object({
  state: calendarOpaqueTokenSchema,
  browserNonce: calendarOpaqueTokenSchema,
});
export async function cancelCalendarAuthorization(
  db: Db,
  userId: string,
  config: CalendarOAuthConfig,
  raw: { state: string; browserNonce: string },
  signal: AbortSignal,
): Promise<Result<undefined, CalendarAuthorizationError>> {
  signal.throwIfAborted();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return err({ kind: "invalid_state" });
  return db.transaction(async (tx) => {
    const owner = await activeCalendarOwner(tx, userId, signal, true);
    if (!owner.ok) return err({ kind: "invalid_state" });
    const [attempt] = await tx
      .select()
      .from(calendarOAuthAttempts)
      .where(
        and(
          eq(calendarOAuthAttempts.stateHash, hashCalendarOAuthToken(parsed.data.state)),
          eq(
            calendarOAuthAttempts.browserBindingHash,
            hashCalendarOAuthToken(parsed.data.browserNonce),
          ),
          eq(calendarOAuthAttempts.userId, userId),
          isNull(calendarOAuthAttempts.consumedAt),
          isNull(calendarOAuthAttempts.cancelledAt),
        ),
      )
      .for("update");
    signal.throwIfAborted();
    if (
      attempt === undefined ||
      attempt.expiresAt.getTime() <= Date.now() ||
      attempt.clientId !== config.clientId ||
      attempt.redirectUri !== config.redirectUri ||
      attempt.requestedAccess !== config.access
    )
      return err({ kind: "invalid_state" });
    const now = new Date();
    await tx
      .update(calendarOAuthAttempts)
      .set({ cancelledAt: now, consumedAt: now, codeVerifierEnc: null })
      .where(eq(calendarOAuthAttempts.stateHash, attempt.stateHash));
    signal.throwIfAborted();
    return ok(undefined);
  });
}
