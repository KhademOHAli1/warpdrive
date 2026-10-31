import { createHash } from "node:crypto";
import type { GenericEndpointContext } from "@better-auth/core";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { jwtVerify } from "jose";
import { z } from "zod";
import type { Db } from "@/db/client";
import { authEmailVerificationTokens, authUsers } from "@/db/schema";
import { enqueueAuthMail } from "@/features/auth/management/mail";
import type { AuthMailInput } from "@/features/auth/management/mailTemplates";
import { lockAuthAccount } from "./accountLock";
import { resolveWorkflowSession } from "./sessionPolicy";

type Binding = typeof authEmailVerificationTokens.$inferSelect;
const claimsSchema = z.object({
  email: z.email(),
  updateTo: z.email().optional(),
  requestType: z.enum(["change-email-confirmation", "change-email-verification"]).optional(),
  exp: z.number().int().positive(),
});
function invalidVerification(): never {
  throw new APIError("BAD_REQUEST", {
    code: "INVALID_VERIFICATION_TOKEN",
    message: "This verification link is invalid or expired",
  });
}
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
async function verifiedClaims(token: string, secret: string) {
  const signed = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  }).catch(() => null);
  const parsed = claimsSchema.safeParse(signed?.payload);
  if (!parsed.success) invalidVerification();
  return parsed.data;
}
function purpose(claims: z.infer<typeof claimsSchema>): Binding["purpose"] {
  if (claims.requestType === undefined && claims.updateTo === undefined) return "verification";
  if (claims.updateTo === undefined || claims.requestType === undefined) invalidVerification();
  return claims.requestType === "change-email-confirmation"
    ? "change_confirmation"
    : "change_verification";
}
function requestToken(request?: Request): string | null {
  return request === undefined ? null : new URL(request.url).searchParams.get("token");
}

export async function enqueueBoundVerificationMail(
  db: Db,
  input: AuthMailInput & { userId: string; url: string },
  secret: string,
  signal: AbortSignal,
  request?: Request,
): Promise<void> {
  const token = new URL(input.url).searchParams.get("token");
  if (token === null) invalidVerification();
  const claims = await verifiedClaims(token, secret);
  const kind = purpose(claims);
  const hash = tokenHash(token);
  const recipient = kind === "change_verification" ? claims.updateTo : claims.email;
  if (recipient?.toLowerCase() !== input.recipient.toLowerCase()) invalidVerification();
  const sourceToken = kind === "change_verification" ? requestToken(request) : null;
  const parentHash = sourceToken === null ? null : tokenHash(sourceToken);
  await db.transaction(async (tx) => {
    await lockAuthAccount(tx, input.userId, signal);
    const [owner] = await tx
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, input.userId))
      .limit(1);
    if (owner === undefined || owner.email.toLowerCase() !== claims.email.toLowerCase())
      invalidVerification();
    if (kind === "verification" && owner.emailVerified) return;
    if (kind === "change_verification") {
      if (parentHash === null) invalidVerification();
      const [parent] = await tx
        .select()
        .from(authEmailVerificationTokens)
        .where(eq(authEmailVerificationTokens.tokenHash, parentHash))
        .limit(1);
      if (
        parent === undefined ||
        parent.userId !== owner.id ||
        parent.purpose !== "change_confirmation" ||
        parent.email.toLowerCase() !== claims.email.toLowerCase() ||
        parent.targetEmail?.toLowerCase() !== claims.updateTo?.toLowerCase() ||
        parent.consumedAt !== null ||
        parent.revokedAt !== null ||
        parent.expiresAt.getTime() <= Date.now()
      )
        invalidVerification();
    }
    // Supersede older links, while allowing the native signer to repeat an identical pending
    // JWT within the same second. A consumed digest is never reactivated by a resend.
    const replaced: Binding["purpose"][] =
      kind === "change_confirmation" ? ["change_confirmation", "change_verification"] : [kind];
    await tx
      .update(authEmailVerificationTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authEmailVerificationTokens.userId, owner.id),
          inArray(authEmailVerificationTokens.purpose, replaced),
          ne(authEmailVerificationTokens.tokenHash, hash),
          isNull(authEmailVerificationTokens.consumedAt),
          isNull(authEmailVerificationTokens.revokedAt),
        ),
      );
    await tx
      .insert(authEmailVerificationTokens)
      .values({
        tokenHash: hash,
        userId: owner.id,
        email: claims.email.toLowerCase(),
        targetEmail: claims.updateTo?.toLowerCase() ?? null,
        purpose: kind,
        parentTokenHash: parentHash,
        expiresAt: new Date(claims.exp * 1000),
      })
      .onConflictDoNothing();
    const [binding] = await tx
      .select()
      .from(authEmailVerificationTokens)
      .where(eq(authEmailVerificationTokens.tokenHash, hash))
      .limit(1);
    if (
      binding === undefined ||
      binding.userId !== owner.id ||
      binding.consumedAt !== null ||
      binding.revokedAt !== null
    )
      invalidVerification();
    const landing = new URL("/auth/verify-email", input.url);
    landing.searchParams.set("token", token);
    await enqueueAuthMail(tx, { ...input, url: landing.toString() }, signal);
  });
}

async function lockVerification(
  db: Db,
  ctx: GenericEndpointContext,
  secret: string,
): Promise<Binding> {
  const query: unknown = ctx.query;
  const parsed = z.object({ token: z.string() }).safeParse(query);
  if (!parsed.success) invalidVerification();
  const claims = await verifiedClaims(parsed.data.token, secret);
  const hash = tokenHash(parsed.data.token);
  const [candidate] = await db
    .select({ userId: authEmailVerificationTokens.userId })
    .from(authEmailVerificationTokens)
    .where(eq(authEmailVerificationTokens.tokenHash, hash))
    .limit(1);
  if (candidate === undefined) invalidVerification();
  const current = await resolveWorkflowSession(
    db,
    new Headers(ctx.headers),
    AbortSignal.timeout(5000),
    { allowPending: true },
  );
  if (current !== null && current.user.id !== candidate.userId)
    throw new APIError("BAD_REQUEST", {
      code: "VERIFICATION_ACCOUNT_MISMATCH",
      message: "Sign out of the current account before using this verification link",
    });
  // Account lock precedes token and user rows for both resend and redemption. The gateway's
  // outer transaction retains these locks through native verification and all after hooks.
  await lockAuthAccount(db, candidate.userId, AbortSignal.timeout(10_000));
  const [binding] = await db
    .select()
    .from(authEmailVerificationTokens)
    .where(eq(authEmailVerificationTokens.tokenHash, hash))
    .for("update");
  if (
    binding === undefined ||
    binding.consumedAt !== null ||
    binding.revokedAt !== null ||
    binding.expiresAt.getTime() <= Date.now() ||
    binding.purpose !== purpose(claims) ||
    binding.email.toLowerCase() !== claims.email.toLowerCase() ||
    binding.targetEmail?.toLowerCase() !== claims.updateTo?.toLowerCase()
  )
    invalidVerification();
  const [owner] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, binding.userId))
    .for("update");
  if (owner === undefined || owner.email.toLowerCase() !== binding.email.toLowerCase())
    invalidVerification();
  return binding;
}

async function nativeVerificationCompleted(db: Db, binding: Binding): Promise<boolean> {
  if (binding.purpose === "change_confirmation") {
    const [child] = await db
      .select({ hash: authEmailVerificationTokens.tokenHash })
      .from(authEmailVerificationTokens)
      .where(
        and(
          eq(authEmailVerificationTokens.parentTokenHash, binding.tokenHash),
          eq(authEmailVerificationTokens.userId, binding.userId),
          eq(authEmailVerificationTokens.purpose, "change_verification"),
          isNull(authEmailVerificationTokens.revokedAt),
        ),
      )
      .limit(1);
    return child !== undefined;
  }
  const [owner] = await db
    .select({ email: authUsers.email, verified: authUsers.emailVerified })
    .from(authUsers)
    .where(eq(authUsers.id, binding.userId))
    .limit(1);
  const expected = binding.purpose === "verification" ? binding.email : binding.targetEmail;
  if (owner === undefined || expected === null) return false;
  return owner.verified && owner.email.toLowerCase() === expected.toLowerCase();
}

export function emailVerificationPlugin(db: Db, secret: string): BetterAuthPlugin {
  return {
    id: "warpdrive-email-verification",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/verify-email",
          handler: createAuthMiddleware(async (ctx) => ({
            context: { warpdriveEmailVerification: await lockVerification(db, ctx, secret) },
          })),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/verify-email",
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.context.returned instanceof APIError && ctx.context.returned.statusCode >= 400)
              return;
            const binding = (ctx as typeof ctx & { warpdriveEmailVerification?: Binding })
              .warpdriveEmailVerification;
            if (binding === undefined) return;
            if (!(await nativeVerificationCompleted(db, binding))) {
              const location = ctx.context.responseHeaders?.get("location");
              if (
                location !== null &&
                location !== undefined &&
                new URL(location, ctx.context.baseURL).searchParams.has("error")
              )
                return;
              // Native mail callbacks intentionally swallow errors. A confirmation without
              // its encrypted successor delivery is not successful, and the gateway must roll
              // back this 5xx so the same unconsumed link can be retried.
              throw new APIError("INTERNAL_SERVER_ERROR", {
                code: "VERIFICATION_NOT_COMPLETED",
                message: "Verification could not be completed. Please try again",
              });
            }
            await db
              .update(authEmailVerificationTokens)
              .set({ consumedAt: new Date() })
              .where(
                and(
                  eq(authEmailVerificationTokens.tokenHash, binding.tokenHash),
                  isNull(authEmailVerificationTokens.consumedAt),
                  isNull(authEmailVerificationTokens.revokedAt),
                ),
              );
          }),
        },
      ],
    },
  };
}

export async function pruneEmailVerificationTokens(db: Db, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await db
    .delete(authEmailVerificationTokens)
    .where(lt(authEmailVerificationTokens.expiresAt, new Date(Date.now() - 86_400_000)));
  signal.throwIfAborted();
}
