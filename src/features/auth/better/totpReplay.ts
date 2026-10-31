import { createHmac } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authTwoFactors, sessions } from "@/db/schema";
import { authTotpReplays } from "@/db/schema/authTotpReplay";
import { normalizeDigits } from "@/utils/normalizeNumberInput";

export const TOTP_REPLAY_TTL_MS = 120_000;

export async function claimTotpCode(
  db: Db,
  input: { factorId: string; code: string; secret: string },
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const now = new Date(Date.now());
  const code = normalizeDigits(input.code).trim();
  const digest = createHmac("sha256", input.secret)
    .update(`${input.factorId}:${code}`)
    .digest("base64url");
  const rows = await db
    .insert(authTotpReplays)
    .values({
      factorId: input.factorId,
      digest,
      expiresAt: new Date(now.getTime() + TOTP_REPLAY_TTL_MS),
    })
    .onConflictDoUpdate({
      target: [authTotpReplays.factorId, authTotpReplays.digest],
      set: { expiresAt: sql`excluded.expires_at` },
      setWhere: lte(authTotpReplays.expiresAt, now),
    })
    .returning({ factorId: authTotpReplays.factorId });
  signal.throwIfAborted();
  return rows.length === 1;
}

export async function pruneTotpReplays(db: Db, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await db.delete(authTotpReplays).where(lte(authTotpReplays.expiresAt, new Date(Date.now())));
  signal.throwIfAborted();
}

// Run after native verification and BEFORE assurancePlugin. New native sessions remain pending
// until the last plugin grants assurance, so a losing concurrent redemption cannot access the app.
export function totpReplayPlugin(db: Db): BetterAuthPlugin {
  return {
    id: "warpdrive-totp-replay",
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === "/two-factor/verify-totp",
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.context.returned instanceof APIError) return;
            const native = ctx.context.newSession ?? ctx.context.session;
            const body: unknown = ctx.body;
            const code =
              typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
            if (native === null || typeof code !== "string") return;
            const signal = AbortSignal.timeout(10_000);
            const [factor] = await db
              .select({ id: authTwoFactors.id })
              .from(authTwoFactors)
              .where(
                and(eq(authTwoFactors.userId, native.user.id), eq(authTwoFactors.verified, true)),
              )
              .limit(1);
            signal.throwIfAborted();
            const claimed =
              factor !== undefined &&
              (await claimTotpCode(
                db,
                { factorId: factor.id, code, secret: ctx.context.secret },
                signal,
              ));
            if (claimed) return;
            if (ctx.context.newSession !== null) {
              await db
                .update(sessions)
                .set({ revokedAt: new Date(Date.now()) })
                .where(eq(sessions.id, ctx.context.newSession.session.id));
              signal.throwIfAborted();
              deleteSessionCookie(ctx);
            }
            throw new APIError("UNAUTHORIZED", {
              code: "INVALID_CODE",
              message: "This code has already been used. Wait for a new code.",
            });
          }),
        },
      ],
    },
  };
}
