import type { GenericEndpointContext, ValidateUserInfoSource } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { hashInvitationToken, validateInvitation } from "@/features/auth/management/invitations";
import { resolveWorkflowSession } from "./sessionPolicy";
import { readCookie } from "./sessionToken";

export const INVITATION_COOKIE = "wd_invite";

export function rejectAuth(code = "AUTH_POLICY_DENIED"): never {
  throw new APIError("FORBIDDEN", { code, message: "Authentication policy rejected this request" });
}

export async function validateIncomingIdentity(
  db: Db,
  input: {
    user: { id?: string; email?: string; emailVerified?: boolean };
    source: ValidateUserInfoSource;
  },
  ctx: GenericEndpointContext,
) {
  const signal = AbortSignal.timeout(10_000);
  const email = input.user.email?.trim().toLowerCase();
  if (email === undefined || email.length === 0) return { error: "AUTH_POLICY_DENIED" };
  if (input.source.action === "create-user") {
    const token = readCookie(new Headers(ctx.headers), INVITATION_COOKIE);
    if (token === null) return { error: "INVITATION_REQUIRED" };
    const invitation = await validateInvitation(db, token, signal);
    if (!invitation.ok || invitation.value.email.toLowerCase() !== email)
      return { error: "INVITATION_REQUIRED" };
    return;
  }
  if (input.source.action === "link-account") {
    const current = await resolveWorkflowSession(db, new Headers(ctx.headers), signal, {
      requireFresh: true,
    });
    if (
      current === null ||
      current.user.id !== input.user.id ||
      current.user.email.toLowerCase() !== email
    )
      return { error: "FRESH_AUTH_REQUIRED" };
    return;
  }
  if (typeof input.user.id !== "string") return { error: "AUTH_POLICY_DENIED" };
  const [local] = await db.select().from(users).where(eq(users.id, input.user.id)).limit(1);
  if (local === undefined || !local.isActive || local.email.toLowerCase() !== email)
    return { error: "AUTH_POLICY_DENIED" };
}

export async function claimInvitedIdentity(
  db: Db,
  user: { email: string },
  ctx: GenericEndpointContext | null,
) {
  if (ctx === null) rejectAuth("INVITATION_REQUIRED");
  const token = readCookie(new Headers(ctx.headers), INVITATION_COOKIE);
  if (token === null) rejectAuth("INVITATION_REQUIRED");
  const valid = await validateInvitation(db, token, AbortSignal.timeout(10_000));
  if (!valid.ok || valid.value.email.toLowerCase() !== user.email.toLowerCase())
    rejectAuth("INVITATION_REQUIRED");
  // This adapter is the transaction-local adapter used by Better Auth's signup operation.
  // Consuming inside it rolls the invitation back if user/account creation fails.
  const adapter = await getCurrentAdapter(ctx.context.adapter);
  const claimed = await adapter.update({
    model: "invitation",
    where: [
      { field: "tokenHash", value: hashInvitationToken(token) },
      { field: "email", value: user.email.toLowerCase() },
      { field: "acceptedAt", value: null },
      { field: "revokedAt", value: null },
      { field: "expiresAt", operator: "gt", value: new Date() },
    ],
    update: { acceptedAt: new Date() },
  });
  if (claimed === null) rejectAuth("INVITATION_REQUIRED");
  const providerVerifiedByInvitation =
    ctx.path.includes("callback") || ctx.path === "/sign-in/social";
  return {
    data: {
      id: valid.value.userId,
      email: valid.value.email,
      ...(providerVerifiedByInvitation ? { emailVerified: true } : {}),
    },
  };
}
