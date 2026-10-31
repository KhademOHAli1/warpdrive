import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { authInvitations, authUsers, settings, users } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { recordSecurityEvent } from "./audit";
import { issueInvitation } from "./invitations";

const recipient = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
type RenewalError =
  | "confirmation_required"
  | "invalid_input"
  | "seed_admin_mismatch"
  | "not_eligible"
  | "invitation_changed";

export async function renewFirstAdministratorInvitation(
  db: Db,
  input: { email: string; operatorConfirmed: boolean },
  signal: AbortSignal,
): Promise<Result<{ userId: string; invitationId: string }, RenewalError>> {
  signal.throwIfAborted();
  if (input.operatorConfirmed !== true) return err("confirmation_required");
  const parsed = recipient.safeParse(input.email);
  if (!parsed.success) return err("invalid_input");
  const configured = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  if (configured !== "" && configured !== parsed.data) return err("seed_admin_mismatch");
  // Snapshot before the election lock: overlapping requests may renew this invitation once,
  // rather than repeatedly invalidating each other's replacement links.
  const [observed] = await db
    .select()
    .from(authInvitations)
    .where(
      and(
        eq(authInvitations.email, parsed.data),
        isNull(authInvitations.acceptedAt),
        isNull(authInvitations.revokedAt),
      ),
    )
    .orderBy(desc(authInvitations.createdAt), desc(authInvitations.id))
    .limit(1);
  signal.throwIfAborted();
  if (observed === undefined) return err("not_eligible");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(815274001::bigint)`);
    signal.throwIfAborted();
    // Match native acceptance's invitation-before-user order. An accepted identity must never
    // become eligible merely because renewal waited for an in-flight invitation claim.
    const invitations = await tx
      .select()
      .from(authInvitations)
      .where(eq(authInvitations.userId, observed.userId))
      .orderBy(authInvitations.id)
      .for("update");
    signal.throwIfAborted();
    const current = invitations.find((row) => row.id === observed.id);
    if (current === undefined || current.acceptedAt !== null || current.revokedAt !== null)
      return err("invitation_changed");
    const [workspace] = await tx.select().from(settings).limit(1);
    signal.throwIfAborted();
    const local = await tx.select().from(users).orderBy(users.id).limit(2).for("no key update");
    signal.throwIfAborted();
    const [identity] = await tx.select({ id: authUsers.id }).from(authUsers).limit(1);
    signal.throwIfAborted();
    const user = local[0];
    const locale = z.enum(["fa", "de", "en"]).safeParse(current.locale);
    if (
      workspace?.bootstrappedAt == null ||
      local.length !== 1 ||
      user?.id !== observed.userId ||
      !user.isAdmin ||
      !user.isActive ||
      user.invitedAt === null ||
      user.googleSub !== null ||
      identity !== undefined ||
      user.email.toLowerCase() !== parsed.data ||
      current.email.toLowerCase() !== parsed.data ||
      current.invitedBy !== user.id ||
      !locale.success ||
      invitations.some((row) => row.acceptedAt !== null) ||
      invitations.filter((row) => row.acceptedAt === null && row.revokedAt === null).length !== 1
    )
      return err("not_eligible");
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const renewed = await issueInvitation(
      tx,
      actor,
      { email: user.email, name: user.name, isAdmin: true, locale: locale.data },
      signal,
    );
    if (!renewed.ok)
      throw new AppError(
        ERROR_IDS.AUTH_POLICY_DENIED,
        "First administrator invitation could not be renewed",
      );
    await recordSecurityEvent(
      tx,
      {
        actorId: null,
        targetUserId: user.id,
        action: "bootstrap.invitation_renewed",
        outcome: "success",
        metadata: { method: "host_operator" },
      },
      signal,
    );
    return ok(renewed.value);
  });
}
