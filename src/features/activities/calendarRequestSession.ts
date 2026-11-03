import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Db } from "@/db/client";
import { sessions } from "@/db/schema";
import {
  AUTH_SESSION_COOKIE,
  hashSessionCredential,
  sessionTokenFromCookie,
} from "@/features/auth/better/sessionToken";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";

// Credential binding only, not an authority/liveness decision. The caller must
// immediately pass this server-only ref to withCalendarActor/currentNativeActor
// under its outer authority fence. Do not accept an internal ID as a credential,
// trust request-body identity, touch idle time or duplicate modern/legacy policy.
export async function readCalendarRequestSession(
  db: Db,
  signal: AbortSignal,
): Promise<NativeSessionRef | null> {
  const value = (await cookies()).get(AUTH_SESSION_COOKIE)?.value;
  if (value === undefined) return null;
  const token = sessionTokenFromCookie(value);
  if (token === null) return null;
  signal.throwIfAborted();
  const [reference] = await db
    .select({ userId: sessions.userId, sessionId: sessions.id })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSessionCredential(token)))
    .limit(1);
  signal.throwIfAborted();
  return reference ?? null;
}
