import type { GenericEndpointContext } from "@better-auth/core";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq, ne } from "drizzle-orm";
import { jwtVerify } from "jose";
import { z } from "zod";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { authAccounts, authPasskeys, authUsers } from "@/db/schema";
import { recordSecurityEvent } from "@/features/auth/management/audit";
import { enqueueAuthMail } from "@/features/auth/management/mail";
import type { AuthMailInput } from "@/features/auth/management/mailTemplates";
import { lockMcpGrants, revokeMcpGrants } from "@/features/auth/management/mcpGrants";
import { authMailLocale } from "./mailLocale";
import { resolveWorkflowSession } from "./sessionPolicy";

type ChangeDetail = NonNullable<AuthMailInput["detail"]>;
interface ChangeIdentity {
  id: string;
  email: string;
}
interface ChangeSnapshot extends ChangeIdentity {
  twoFactorEnabled: boolean;
  updateTo?: string;
}
const snapshotKey = "warpdriveSecurityChange";
function isProviderCallback(path: string): boolean {
  return /^\/(?:oauth2\/)?callback(?:\/|$)/.test(path);
}
const grantChangingPaths = new Set([
  "/change-password",
  "/reset-password",
  "/two-factor/verify-totp",
  "/two-factor/disable",
]);
const grantChangingActions = new Set([
  "password.changed",
  "password.reset",
  "factor.enabled",
  "factor.disabled",
]);
const changes: Record<string, { action: string; detail: ChangeDetail }> = {
  "/change-password": { action: "password.changed", detail: "password" },
  "/set-password": { action: "password.created", detail: "password" },
  "/two-factor/disable": { action: "factor.disabled", detail: "factor" },
  "/two-factor/generate-backup-codes": { action: "recovery.rotated", detail: "recovery" },
  "/passkey/verify-registration": { action: "passkey.added", detail: "factor" },
  "/passkey/update-passkey": { action: "passkey.renamed", detail: "factor" },
  "/passkey/delete-passkey": { action: "passkey.removed", detail: "factor" },
};

// Notification payloads contain only the category and trusted account addresses. Native request
// bodies, credential identifiers, device names, tokens and factor material never enter this sink.
export async function recordNativeSecurityChange(
  db: Db,
  user: ChangeIdentity,
  action: string,
  detail: ChangeDetail,
  request?: Request,
  otherRecipient?: string,
): Promise<void> {
  const signal = AbortSignal.timeout(10_000);
  const locale = await authMailLocale(db, user.id, request);
  await db.transaction(async (tx) => {
    if (grantChangingActions.has(action)) await revokeMcpGrants(tx, user.id, signal);
    await recordSecurityEvent(
      tx,
      { actorId: user.id, targetUserId: user.id, action: `security.${action}`, outcome: "success" },
      signal,
    );
    for (const recipient of new Set(
      [user.email, otherRecipient].filter((email): email is string => email !== undefined),
    )) {
      await enqueueAuthMail(
        tx,
        {
          userId: user.id,
          recipient,
          locale,
          kind: "security_change",
          detail,
          url: `${env.BASE_URL}/settings/security`,
        },
        signal,
      );
    }
  });
}

// Native account creation also runs for first-time enrollment. A linking announcement is only
// appropriate when a usable method already existed before this new external account was added.
export async function recordNativeProviderLink(
  db: Db,
  account: { id: string; userId: string; providerId: string },
  request?: Request,
): Promise<void> {
  if (account.providerId === "credential") return;
  const [identity, otherAccounts, passkeys] = await Promise.all([
    db
      .select({ id: authUsers.id, email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, account.userId))
      .limit(1),
    db
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, account.userId), ne(authAccounts.id, account.id)))
      .limit(1),
    db
      .select({ id: authPasskeys.id })
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, account.userId))
      .limit(1),
  ]);
  if (identity[0] === undefined || (otherAccounts.length === 0 && passkeys.length === 0)) return;
  await recordNativeSecurityChange(db, identity[0], "provider.linked", "provider", request);
}

async function emailChangeSnapshot(
  db: Db,
  ctx: GenericEndpointContext,
  secret: string,
): Promise<ChangeSnapshot | null> {
  const query: unknown = ctx.query;
  const parsedToken = z.object({ token: z.string() }).safeParse(query);
  if (!parsedToken.success) return null;
  const token = parsedToken.data.token;
  const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  }).catch(() => null);
  const payload = z
    .object({
      email: z.email(),
      updateTo: z.email(),
      requestType: z.literal("change-email-verification"),
    })
    .safeParse(verified?.payload);
  if (!payload.success) return null;
  const [user] = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      twoFactorEnabled: authUsers.twoFactorEnabled,
    })
    .from(authUsers)
    .where(eq(authUsers.email, payload.data.email))
    .limit(1);
  return user === undefined ? null : { ...user, updateTo: payload.data.updateTo };
}

async function snapshot(
  db: Db,
  ctx: GenericEndpointContext,
  secret: string,
): Promise<ChangeSnapshot | null> {
  if (ctx.path === "/verify-email") return emailChangeSnapshot(db, ctx, secret);
  const current = await resolveWorkflowSession(
    db,
    new Headers(ctx.headers),
    AbortSignal.timeout(5000),
    { allowPending: true },
  );
  return current === null
    ? null
    : {
        id: current.user.id,
        email: current.user.email,
        twoFactorEnabled: current.authUser.twoFactorEnabled,
      };
}

async function completedChange(
  db: Db,
  ctx: GenericEndpointContext,
  before: ChangeSnapshot,
): Promise<void> {
  if (ctx.path === "/verify-email" || ctx.path === "/two-factor/verify-totp") {
    const [current] = await db
      .select({
        email: authUsers.email,
        emailVerified: authUsers.emailVerified,
        twoFactorEnabled: authUsers.twoFactorEnabled,
      })
      .from(authUsers)
      .where(eq(authUsers.id, before.id))
      .limit(1);
    if (current === undefined) return;
    if (ctx.path === "/verify-email") {
      if (
        before.updateTo === undefined ||
        before.email === current.email ||
        !current.emailVerified ||
        current.email !== before.updateTo
      )
        return;
      await recordNativeSecurityChange(
        db,
        before,
        "email.changed",
        "email",
        ctx.request,
        current.email,
      );
    } else if (!before.twoFactorEnabled && current.twoFactorEnabled) {
      await recordNativeSecurityChange(db, before, "factor.enabled", "factor", ctx.request);
    }
    return;
  }
  const change = changes[ctx.path];
  if (change !== undefined)
    await recordNativeSecurityChange(db, before, change.action, change.detail, ctx.request);
}

export function securityChangePlugin(db: Db, secret: string): BetterAuthPlugin {
  const selected = (ctx: { path?: string }) =>
    ctx.path !== undefined &&
    (ctx.path in changes ||
      ctx.path === "/reset-password" ||
      ctx.path === "/verify-email" ||
      ctx.path === "/two-factor/verify-totp" ||
      isProviderCallback(ctx.path));
  return {
    id: "warpdrive-security-changes",
    hooks: {
      before: [
        {
          matcher: selected,
          handler: createAuthMiddleware(async (ctx) => {
            // The gateway holds the account lock and transaction. Take the grant lock before
            // native hooks can update CRM user rows, matching policy/promotion lock order.
            if (grantChangingPaths.has(ctx.path) || isProviderCallback(ctx.path))
              await lockMcpGrants(db, AbortSignal.timeout(10_000));
            return {
              context: {
                [snapshotKey]:
                  ctx.path === "/reset-password" || isProviderCallback(ctx.path)
                    ? null
                    : await snapshot(db, ctx, secret),
              },
            };
          }),
        },
      ],
      after: [
        {
          matcher: selected,
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.context.returned instanceof APIError && ctx.context.returned.statusCode >= 400)
              return;
            const before = (
              ctx as typeof ctx & {
                warpdriveSecurityChange?: ChangeSnapshot | null;
              }
            ).warpdriveSecurityChange;
            if (before !== undefined && before !== null) await completedChange(db, ctx, before);
          }),
        },
      ],
    },
  };
}
