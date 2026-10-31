import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { authInvitations, authMailOutbox } from "@/db/schema/authManagement";
import type { Locale } from "@/features/i18n/registry";
import { inviteUser } from "@/features/identity/invite.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { recordSecurityEvent } from "./audit";
import { INVITATION_TOKEN_BYTES, INVITATION_TTL_MS } from "./domain";
import { enqueueAuthMail } from "./mail";

export type InvitationError = "forbidden" | "email_taken" | "invalid_invitation" | "not_found";
export interface IssueInvitationInput {
  email: string;
  name: string;
  isAdmin: boolean;
  locale: Locale;
}
export interface ValidInvitation {
  id: string;
  userId: string;
  email: string;
  name: string;
  expiresAt: Date;
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function canInvite(actor: PermSetUser): boolean {
  return actor.isActive && (actor.type === "admin" || actor.flags.has("permissions.manage"));
}

async function mintInvitation(
  db: Db,
  actor: PermSetUser,
  userId: string,
  email: string,
  locale: Locale,
  signal: AbortSignal,
): Promise<{ userId: string; invitationId: string }> {
  signal.throwIfAborted();
  const now = new Date();
  await db
    .update(authInvitations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(authInvitations.userId, userId),
        isNull(authInvitations.revokedAt),
        isNull(authInvitations.acceptedAt),
      ),
    );
  // Cancel any queued bearer link when it is replaced; an already delivered old link is invalid too.
  await db
    .update(authMailOutbox)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(authMailOutbox.userId, userId),
        eq(authMailOutbox.kind, "invitation"),
        inArray(authMailOutbox.status, ["pending", "failed"]),
      ),
    );
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
  const [created] = await db
    .insert(authInvitations)
    .values({
      userId,
      email,
      locale,
      invitedBy: actor.id,
      tokenHash: hashInvitationToken(token),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    })
    .returning({ id: authInvitations.id });
  if (created === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Invitation insert returned no rows");
  const url = new URL("/auth/invite", env.BASE_URL);
  url.searchParams.set("token", token);
  await enqueueAuthMail(
    db,
    {
      userId,
      invitationId: created.id,
      recipient: email,
      kind: "invitation",
      locale,
      url: url.toString(),
    },
    signal,
  );
  await recordSecurityEvent(
    db,
    { actorId: actor.id, targetUserId: userId, action: "invitation.issue", outcome: "success" },
    signal,
  );
  return { userId, invitationId: created.id };
}

export async function issueInvitation(
  db: Db,
  actor: PermSetUser,
  input: IssueInvitationInput,
  signal: AbortSignal,
): Promise<Result<{ userId: string; invitationId: string }, InvitationError>> {
  if (!canInvite(actor) || (input.isAdmin && actor.type !== "admin")) return err("forbidden");
  signal.throwIfAborted();
  const email = input.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.email, email)).for("update");
    if (existing !== undefined) {
      if (
        !existing.isActive ||
        existing.invitedAt === null ||
        existing.googleSub !== null ||
        existing.isAdmin !== input.isAdmin
      )
        return err("email_taken");
      if (existing.isAdmin && actor.type !== "admin") return err("forbidden");
      return ok(await mintInvitation(tx, actor, existing.id, email, input.locale, signal));
    }
    const created = await inviteUser(tx, actor, input, signal);
    if (!created.ok) return err(created.error.id.includes("PERM") ? "forbidden" : "email_taken");
    return ok(await mintInvitation(tx, actor, created.value.userId, email, input.locale, signal));
  });
}

export async function validateInvitation(
  db: Db,
  token: string,
  signal: AbortSignal,
): Promise<Result<ValidInvitation, "invalid_invitation">> {
  signal.throwIfAborted();
  if (token.length < 40 || token.length > 128) return err("invalid_invitation");
  const [row] = await db
    .select({
      id: authInvitations.id,
      userId: authInvitations.userId,
      email: authInvitations.email,
      name: users.name,
      expiresAt: authInvitations.expiresAt,
    })
    .from(authInvitations)
    .innerJoin(users, eq(users.id, authInvitations.userId))
    .where(
      and(
        eq(authInvitations.tokenHash, hashInvitationToken(token)),
        isNull(authInvitations.acceptedAt),
        isNull(authInvitations.revokedAt),
        gt(authInvitations.expiresAt, new Date()),
        eq(users.isActive, true),
        eq(users.email, authInvitations.email),
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  return row === undefined ? err("invalid_invitation") : ok(row);
}

export async function consumeInvitation(
  db: Db,
  token: string,
  email: string,
  signal: AbortSignal,
): Promise<Result<{ userId: string }, "invalid_invitation">> {
  signal.throwIfAborted();
  const normalizedEmail = email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const valid = await validateInvitation(tx, token, signal);
    if (!valid.ok || valid.value.email.toLowerCase() !== normalizedEmail)
      return err("invalid_invitation");
    // Lock the recipient with suspension/acceptance so a race cannot revive a disabled account.
    const [recipient] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, valid.value.userId), eq(users.isActive, true)))
      .for("update");
    if (recipient === undefined || recipient.email.toLowerCase() !== normalizedEmail)
      return err("invalid_invitation");
    const [claimed] = await tx
      .update(authInvitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(authInvitations.id, valid.value.id),
          isNull(authInvitations.acceptedAt),
          isNull(authInvitations.revokedAt),
          gt(authInvitations.expiresAt, new Date()),
        ),
      )
      .returning({ userId: authInvitations.userId });
    if (claimed === undefined) return err("invalid_invitation");
    await tx.update(users).set({ invitedAt: null }).where(eq(users.id, claimed.userId));
    await recordSecurityEvent(
      tx,
      {
        actorId: claimed.userId,
        targetUserId: claimed.userId,
        action: "invitation.accept",
        outcome: "success",
      },
      signal,
    );
    return ok(claimed);
  });
}

export async function resendInvitation(
  db: Db,
  actor: PermSetUser,
  invitationId: string,
  signal: AbortSignal,
): Promise<Result<{ userId: string; invitationId: string }, InvitationError>> {
  if (!canInvite(actor)) return err("forbidden");
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(authInvitations)
      .where(eq(authInvitations.id, invitationId));
    if (invitation === undefined || invitation.acceptedAt !== null) return err("not_found");
    const [recipient] = await tx
      .select()
      .from(users)
      .where(eq(users.id, invitation.userId))
      .for("update");
    if (recipient === undefined || !recipient.isActive || recipient.invitedAt === null)
      return err("not_found");
    if (recipient.isAdmin && actor.type !== "admin") return err("forbidden");
    const locale: Locale =
      invitation.locale === "fa" || invitation.locale === "de" ? invitation.locale : "en";
    return ok(await mintInvitation(tx, actor, recipient.id, recipient.email, locale, signal));
  });
}

export async function revokeInvitation(
  db: Db,
  actor: PermSetUser,
  invitationId: string,
  signal: AbortSignal,
): Promise<Result<true, InvitationError>> {
  if (!canInvite(actor)) return err("forbidden");
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select({ userId: authInvitations.userId, isAdmin: users.isAdmin })
      .from(authInvitations)
      .innerJoin(users, eq(users.id, authInvitations.userId))
      .where(eq(authInvitations.id, invitationId));
    if (invitation === undefined) return err("not_found");
    if (invitation.isAdmin && actor.type !== "admin") return err("forbidden");
    const [revoked] = await tx
      .update(authInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authInvitations.id, invitationId),
          isNull(authInvitations.acceptedAt),
          isNull(authInvitations.revokedAt),
        ),
      )
      .returning({ id: authInvitations.id });
    if (revoked === undefined) return err("not_found");
    await tx
      .update(authMailOutbox)
      .set({ status: "cancelled" })
      .where(
        and(eq(authMailOutbox.invitationId, invitationId), eq(authMailOutbox.status, "pending")),
      );
    await recordSecurityEvent(
      tx,
      {
        actorId: actor.id,
        targetUserId: invitation.userId,
        action: "invitation.revoke",
        outcome: "success",
      },
      signal,
    );
    return ok(true);
  });
}
