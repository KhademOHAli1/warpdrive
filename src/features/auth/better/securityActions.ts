import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { authAccounts, authPasskeys, authRecoveryRequests, sessions } from "@/db/schema";
import { recordSecurityEvent } from "@/features/auth/management/audit";
import { enqueueAuthMail } from "@/features/auth/management/mail";
import { encryptToken } from "@/features/email/crypto";
import type { createBetterAuth } from "./auth";
import type { WorkflowResponse } from "./contracts";
import { authMailLocale } from "./mailLocale";
import { resolveWorkflowSession } from "./sessionPolicy";
import { usableAuthenticationMethods } from "./usableMethods";

const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("reauthenticate"), password: z.string().min(1).max(128) }),
  z.strictObject({ action: z.literal("revokeSession"), id: z.uuid() }),
  z.strictObject({ action: z.literal("revokeOthers") }),
  z.strictObject({ action: z.literal("revokeAll") }),
  z.strictObject({
    action: z.literal("unlinkAccount"),
    providerId: z.string().min(1),
    accountId: z.string().min(1),
  }),
  z.strictObject({
    action: z.literal("requestClosure"),
    reason: z.string().trim().min(1).max(2000),
  }),
]);

async function unlinkAccount(
  db: Db,
  auth: ReturnType<typeof createBetterAuth>,
  userId: string,
  sessionId: string,
  providerId: string,
  accountId: string,
  signal: AbortSignal,
) {
  const context = await auth.$context;
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-auth-methods'), hashtext(${userId}))`,
    );
    signal.throwIfAborted();
    // Serialize removal so concurrent requests cannot each remove the other's fallback method.
    await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    const accounts = await tx
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.userId, userId))
      .for("update");
    const [passkey] = await tx
      .select({ id: authPasskeys.id })
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, userId))
      .limit(1);
    const remaining = accounts.filter(
      (account) => account.providerId !== providerId || account.accountId !== accountId,
    );
    const usable = usableAuthenticationMethods(context, remaining, passkey === undefined ? 0 : 1);
    if (!usable.hasAccount && usable.passkeys === 0) return false;
    const deleted = await tx
      .delete(authAccounts)
      .where(
        and(
          eq(authAccounts.userId, userId),
          eq(authAccounts.providerId, providerId),
          eq(authAccounts.accountId, accountId),
        ),
      )
      .returning({ id: authAccounts.id });
    return deleted.length === 1;
  });
}

async function requestClosure(db: Db, userId: string, reason: string, signal: AbortSignal) {
  const [pending] = await db
    .select({ id: authRecoveryRequests.id })
    .from(authRecoveryRequests)
    .where(
      and(
        eq(authRecoveryRequests.userId, userId),
        eq(authRecoveryRequests.kind, "account_closure"),
        eq(authRecoveryRequests.status, "pending"),
      ),
    )
    .limit(1);
  const reasonEnc = encryptToken(reason);
  if (pending === undefined)
    await db.insert(authRecoveryRequests).values({ userId, kind: "account_closure", reasonEnc });
  else
    await db
      .update(authRecoveryRequests)
      .set({ reasonEnc })
      .where(eq(authRecoveryRequests.id, pending.id));
  signal.throwIfAborted();
}

async function revokeSessions(
  db: Db,
  userId: string,
  currentId: string,
  command: Extract<
    z.infer<typeof commandSchema>,
    { action: "revokeSession" | "revokeOthers" | "revokeAll" }
  >,
  signal: AbortSignal,
) {
  const target =
    command.action === "revokeSession"
      ? eq(sessions.id, command.id)
      : command.action === "revokeOthers"
        ? ne(sessions.id, currentId)
        : undefined;
  const ended = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), target, isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  signal.throwIfAborted();
  return command.action !== "revokeSession" || ended.length > 0;
}

export async function runSecurityAction(
  db: Db,
  auth: ReturnType<typeof createBetterAuth>,
  headers: Headers,
  raw: unknown,
  signal: AbortSignal,
): Promise<WorkflowResponse<Record<string, never>>> {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const command = parsed.data;
  const current = await resolveWorkflowSession(db, headers, signal, {
    allowPending: command.action === "reauthenticate",
    requireFresh: command.action !== "reauthenticate",
  });
  if (current === null) return { ok: false, error: "FRESH_AUTH_REQUIRED" };
  const userId = current.user.id;
  if (command.action === "reauthenticate") {
    try {
      await auth.api.verifyPassword({ body: { password: command.password }, headers });
    } catch {
      return { ok: false, error: "INVALID_CREDENTIALS" };
    }
    await db
      .update(sessions)
      .set({ freshAuthenticatedAt: new Date() })
      .where(and(eq(sessions.id, current.session.id), isNull(sessions.revokedAt)));
    await recordSecurityEvent(
      db,
      {
        actorId: userId,
        targetUserId: userId,
        action: "authentication.reauthenticate",
        outcome: "success",
      },
      signal,
    );
    return { ok: true, data: {} };
  }
  if (command.action === "unlinkAccount") {
    const changed = await unlinkAccount(
      db,
      auth,
      userId,
      current.session.id,
      command.providerId,
      command.accountId,
      signal,
    );
    if (!changed) return { ok: false, error: "LAST_AUTH_METHOD" };
  } else if (command.action === "requestClosure") {
    await requestClosure(db, userId, command.reason, signal);
    // The free-form reason stays out of authentication audit logs and notification payloads.
  } else {
    if (!(await revokeSessions(db, userId, current.session.id, command, signal)))
      return { ok: false, error: "NOT_FOUND" };
  }
  await recordSecurityEvent(
    db,
    {
      actorId: userId,
      targetUserId: userId,
      action: `account.${command.action}`,
      outcome: "success",
    },
    signal,
  );
  await enqueueAuthMail(
    db,
    {
      userId,
      recipient: current.user.email,
      locale: await authMailLocale(db, userId),
      kind: "security_change",
      detail: command.action === "unlinkAccount" ? "provider" : "sessions",
    },
    signal,
  );
  signal.throwIfAborted();
  return { ok: true, data: {} };
}
