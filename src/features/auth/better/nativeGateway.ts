import { and, eq, gt, TransactionRollbackError } from "drizzle-orm";
import { type Env, env } from "@/config/env";
import type { Db } from "@/db/client";
import { authPasskeys, authVerifications } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { lockAuthAccount } from "./accountLock";
import { createBetterAuth } from "./auth";
import { prepareNativeAuthRequest } from "./prepareNativeAuthRequest";
import { resolveWorkflowSession } from "./sessionPolicy";
import { hashSessionCredential, readCookie, sessionTokenFromCookie } from "./sessionToken";

// These lookups choose a serialization lock ONLY. Cookie signatures, proof ownership,
// challenges and active-user policy are re-read and verified by native auth inside the lock.
async function proofOwner(db: Db, request: Request, signal: AbortSignal): Promise<string | null> {
  if (request.method !== "POST") return null;
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/passkey/verify-authentication") {
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      return null;
    }
    signal.throwIfAborted();
    if (typeof body !== "object" || body === null || !("response" in body)) return null;
    const response = body.response;
    if (
      typeof response !== "object" ||
      response === null ||
      !("id" in response) ||
      typeof response.id !== "string"
    )
      return null;
    const [passkey] = await db
      .select({ userId: authPasskeys.userId })
      .from(authPasskeys)
      .where(eq(authPasskeys.credentialID, response.id))
      .limit(1);
    signal.throwIfAborted();
    return passkey?.userId ?? null;
  }
  if (
    path !== "/api/auth/two-factor/verify-totp" &&
    path !== "/api/auth/two-factor/verify-backup-code"
  )
    return null;
  const cookie = readCookie(request.headers, "better-auth.two_factor");
  const identifier = cookie === null ? null : sessionTokenFromCookie(cookie);
  if (identifier === null || !identifier.startsWith("2fa-")) return null;
  const [challenge] = await db
    .select({ userId: authVerifications.value })
    .from(authVerifications)
    .where(
      and(
        eq(authVerifications.identifier, hashSessionCredential(identifier)),
        gt(authVerifications.expiresAt, new Date()),
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  return challenge?.userId ?? null;
}

export async function nativeAuthGateway(
  db: Db,
  incoming: Request,
  config: Env = env,
): Promise<Response> {
  const signal = AbortSignal.timeout(20_000);
  const prepared = await prepareNativeAuthRequest(incoming, signal);
  if (!prepared.ok)
    return Response.json(
      { error: "AUTH_BODY_REJECTED" },
      {
        status: prepared.error,
        headers: { "Cache-Control": "no-store" },
      },
    );
  const request = prepared.value;
  // Anonymous resets/callbacks also need this transaction: before-hook grant locks must span
  // the native mutation and after-hook outbox writes. Account locks keep their sorted order.
  let failedResponse: Response | undefined;
  try {
    // Every handler route participates, including GET callbacks/session refresh. This fence
    // can span existing provider exchanges; SQL timeouts do not cancel that network I/O.
    return await withCurrentAuthority(db, "write", signal, async (authorityTx) =>
      authorityTx.transaction(async (tx) => {
        const current = await resolveWorkflowSession(tx, request.headers, signal, {
          allowPending: true,
        });
        const owner = await proofOwner(tx, request, signal);
        const owners = [
          ...new Set(
            [current?.user.id, owner].filter((id): id is string => id !== undefined && id !== null),
          ),
        ].sort();
        for (const userId of owners) await lockAuthAccount(tx, userId, signal);
        const response = await createBetterAuth(tx, config).handler(request);
        // Native handlers translate hook failures into responses. Abort partial mutations on
        // operational failure; retain 4xx writes such as rate limits, lockouts and replay denial.
        if (response.status >= 500) {
          failedResponse = response;
          tx.rollback();
        }
        return response;
      }),
    );
  } catch (error) {
    if (failedResponse !== undefined && error instanceof TransactionRollbackError)
      return failedResponse;
    throw error;
  }
}
