import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions } from "@/db/schema";
import { recordSecurityEvent } from "@/features/auth/management/audit";

// Runs AFTER native factor hooks. An early options.hooks.after would see the password
// session before the native plugin discards it for a pending second-factor challenge.
export function assurancePlugin(db: Db): BetterAuthPlugin {
  return {
    id: "warpdrive-assurance",
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const signal = AbortSignal.timeout(10_000);
            const failed = ctx.context.returned instanceof APIError;
            const login =
              ctx.path.startsWith("/sign-in/") ||
              ctx.path.includes("/callback/") ||
              ctx.path.startsWith("/two-factor/verify-") ||
              ctx.path === "/passkey/verify-authentication";
            if (failed) {
              if (login)
                await recordSecurityEvent(
                  db,
                  { action: "authentication.login", outcome: "denied" },
                  signal,
                );
              return;
            }
            const native = ctx.context.newSession ?? ctx.context.session;
            if (native === null) return;
            const factor =
              ctx.path === "/two-factor/verify-totp" ||
              ctx.path === "/two-factor/verify-backup-code";
            const passkey = ctx.path === "/passkey/verify-authentication";
            if (!login || (!ctx.context.newSession && !factor)) return;
            const now = new Date();
            await db
              .update(sessions)
              .set({
                assurance: factor ? "mfa" : passkey ? "passkey" : "password",
                ...(factor ? { mfaVerifiedAt: now } : {}),
                freshAuthenticatedAt: now,
                lastSeenAt: now,
              })
              .where(eq(sessions.id, native.session.id));
            await recordSecurityEvent(
              db,
              {
                actorId: native.user.id,
                targetUserId: native.user.id,
                action: factor ? "authentication.factor" : "authentication.login",
                outcome: "success",
              },
              signal,
            );
          }),
        },
      ],
    },
  };
}
