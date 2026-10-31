import type { GenericEndpointContext } from "@better-auth/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authAccounts, authPasskeys } from "@/db/schema";
import { validateInvitation } from "@/features/auth/management/invitations";
import { normalizeDigits } from "@/utils/normalizeNumberInput";
import { INVITATION_COOKIE, rejectAuth } from "./admission";
import { isFreshAuthentication } from "./freshness";
import { hookBody } from "./hookBody";
import { hashRecoveryInput } from "./recoveryCodes";
import { resolveWorkflowSession } from "./sessionPolicy";
import { readCookie } from "./sessionToken";
import { type AuthMethodContext, usableAuthenticationMethods } from "./usableMethods";

export const BLOCKED_AUTH_PATHS = [
  "/list-sessions",
  "/revoke-session",
  "/revoke-other-sessions",
  "/revoke-sessions",
  "/unlink-account",
  "/delete-user",
  "/delete-user/callback",
  "/update-session",
  "/get-access-token",
  "/refresh-token",
  "/two-factor/view-backup-codes",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/totp/generate",
];
const SENSITIVE = new Set([
  "/change-password",
  "/set-password",
  "/change-email",
  "/update-user",
  "/link-social",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
]);
const ENROLL = new Set([
  "/two-factor/enable",
  "/two-factor/get-totp-uri",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
]);

async function guardInvitation(db: Db, ctx: GenericEndpointContext, body: Record<string, unknown>) {
  const token = readCookie(new Headers(ctx.headers), INVITATION_COOKIE);
  const invitation =
    token === null ? null : await validateInvitation(db, token, AbortSignal.timeout(5000));
  if (
    invitation === null ||
    !invitation.ok ||
    typeof body.email !== "string" ||
    invitation.value.email.toLowerCase() !== body.email.trim().toLowerCase()
  )
    rejectAuth("INVITATION_REQUIRED");
}

async function requireFreshFactor(
  db: Db,
  ctx: GenericEndpointContext,
  sensitive: boolean,
  signal: AbortSignal,
) {
  const current = await resolveWorkflowSession(db, new Headers(ctx.headers), signal, {
    allowPending: !sensitive,
  });
  if (
    current === null ||
    current.session.freshAuthenticatedAt === null ||
    Date.now() - current.session.freshAuthenticatedAt.getTime() >=
      current.policy.freshMinutes * 60_000
  )
    rejectAuth("FRESH_AUTH_REQUIRED");
  const [existingPasskey] = await db
    .select({ id: authPasskeys.id })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, current.user.id))
    .limit(1);
  const hasStrongFactor = current.authUser.twoFactorEnabled || existingPasskey !== undefined;
  // An unauthenticated second-factor session may bootstrap its FIRST factor only.
  // Adding a replacement or revealing an existing TOTP secret requires a verified factor.
  if (
    (sensitive || hasStrongFactor) &&
    !isFreshAuthentication(
      current.session,
      current.user.isAdmin || hasStrongFactor || current.policy.requireMfaForAll,
      current.policy,
    )
  )
    rejectAuth("FRESH_AUTH_REQUIRED");
  if (!current.authUser.emailVerified) rejectAuth("EMAIL_NOT_VERIFIED");
  if (ctx.path === "/two-factor/enable" && current.authUser.twoFactorEnabled)
    rejectAuth("FRESH_AUTH_REQUIRED");
  return current;
}

async function guardLastMethod(
  db: Db,
  context: AuthMethodContext,
  path: string,
  body: Record<string, unknown>,
  current: NonNullable<Awaited<ReturnType<typeof resolveWorkflowSession>>>,
  signal: AbortSignal,
) {
  const [passkeys, accounts] = await Promise.all([
    db.select().from(authPasskeys).where(eq(authPasskeys.userId, current.user.id)),
    db.select().from(authAccounts).where(eq(authAccounts.userId, current.user.id)),
  ]);
  signal.throwIfAborted();
  const usable = usableAuthenticationMethods(context, accounts, passkeys.length);
  if (
    path === "/two-factor/disable" &&
    (current.user.isAdmin || current.policy.requireMfaForAll) &&
    usable.passkeys === 0
  )
    rejectAuth("LAST_AUTH_METHOD");
  if (path === "/passkey/delete-passkey") {
    const targetId = typeof body.id === "string" ? body.id : "";
    const owned = passkeys.some((key) => key.id === targetId);
    const strongRequired = current.user.isAdmin || current.policy.requireMfaForAll;
    if (
      owned &&
      usable.passkeys <= 1 &&
      ((strongRequired && !current.authUser.twoFactorEnabled) || !usable.hasAccount)
    )
      rejectAuth("LAST_AUTH_METHOD");
    // The native endpoint also checks ownership, this query prevents using another user's
    // metadata to satisfy our last-method policy.
    if (!owned) {
      const [target] = await db
        .select({ id: authPasskeys.id })
        .from(authPasskeys)
        .where(and(eq(authPasskeys.id, targetId), eq(authPasskeys.userId, current.user.id)));
      if (target === undefined) rejectAuth();
    }
  }
}

export async function guardAuthEndpoint(db: Db, ctx: GenericEndpointContext): Promise<void> {
  if (BLOCKED_AUTH_PATHS.includes(ctx.path)) rejectAuth();
  const body = hookBody(ctx.body);
  if (ctx.path === "/sign-up/email") await guardInvitation(db, ctx, body);
  if (typeof body.code === "string") {
    const code = normalizeDigits(body.code).trim();
    body.code = ctx.path === "/two-factor/verify-backup-code" ? hashRecoveryInput(code) : code;
  }
  if ("trustDevice" in body) body.trustDevice = false;
  const sensitive = SENSITIVE.has(ctx.path);
  if (!sensitive && !ENROLL.has(ctx.path)) return;
  const signal = AbortSignal.timeout(10_000);
  const current = await requireFreshFactor(db, ctx, sensitive, signal);
  if (ctx.path === "/change-password") body.revokeOtherSessions = true;
  if (ctx.path === "/passkey/delete-passkey" || ctx.path === "/two-factor/disable")
    await guardLastMethod(db, ctx.context, ctx.path, body, current, signal);
}
