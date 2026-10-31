import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { settings, userPreferences, users, visibilityGroupMembers } from "@/db/schema";
import { authMailOutbox } from "@/db/schema/authManagement";
import { createBetterAuth } from "@/features/auth/better/auth";
import { ensureSeedData } from "@/features/auth/seed";
import { resolveLocalePreferences } from "@/features/i18n/preferences";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { recordSecurityEvent } from "./audit";
import { issueInvitation } from "./invitations";
import { type OperatorRecoveryInput, reviewEmergencyRecovery } from "./operatorEmergency";
import { completeApprovedRecovery } from "./operatorRecovery";

export { renewFirstAdministratorInvitation } from "./bootstrapRenewal";

const inputSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(200),
  locale: z.enum(["fa", "de", "en"]),
  operatorConfirmed: z.literal(true),
});
export interface BootstrapOperatorInput {
  email: string;
  name: string;
  locale: "fa" | "de" | "en";
  operatorConfirmed: boolean;
}
type BootstrapError =
  | "confirmation_required"
  | "invalid_input"
  | "seed_admin_mismatch"
  | "already_initialized";

// Host-only: no route imports this service. It never promotes or binds an existing identity.
export async function bootstrapFirstAdministrator(
  db: Db,
  input: BootstrapOperatorInput,
  signal: AbortSignal,
): Promise<Result<{ userId: string; invitationId: string }, BootstrapError>> {
  signal.throwIfAborted();
  if (!input.operatorConfirmed) return err("confirmation_required");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const seedEmail = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  if (seedEmail !== "" && parsed.data.email !== seedEmail) return err("seed_admin_mismatch");
  return db.transaction(async (tx) => {
    // Same election lock as the legacy bootstrap path; concurrent host calls cannot elect twice.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(815274001::bigint)`);
    signal.throwIfAborted();
    const [workspace] = await tx
      .select({ bootstrappedAt: settings.bootstrappedAt })
      .from(settings)
      .limit(1);
    const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
    if (workspace?.bootstrappedAt != null || existing !== undefined)
      return err("already_initialized");
    const seed = await ensureSeedData(tx, signal);
    const [user] = await tx
      .insert(users)
      .values({
        email: parsed.data.email,
        name: parsed.data.name,
        isAdmin: true,
        invitedAt: new Date(),
        permissionSetId: seed.adminSetId,
        primaryVisibilityGroupId: seed.everyoneGroupId,
      })
      .returning({ id: users.id });
    if (user === undefined)
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Bootstrap user insert returned no row");
    await tx
      .insert(visibilityGroupMembers)
      .values({ groupId: seed.everyoneGroupId, userId: user.id });
    await tx.insert(userPreferences).values({
      userId: user.id,
      ui: { localePreferences: resolveLocalePreferences({ locale: parsed.data.locale }) },
    });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set([seed.everyoneGroupId]),
    };
    const invitation = await issueInvitation(tx, actor, { ...parsed.data, isAdmin: true }, signal);
    if (!invitation.ok)
      throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "Bootstrap invitation could not be created");
    await tx.update(settings).set({ bootstrappedAt: new Date() }).where(eq(settings.id, true));
    await recordSecurityEvent(
      tx,
      {
        actorId: user.id,
        targetUserId: user.id,
        action: "bootstrap.invitation",
        outcome: "success",
      },
      signal,
    );
    signal.throwIfAborted();
    return ok(invitation.value);
  });
}

// Factor removal and native reset-link enqueue are atomic. Operational failure rolls both back.
// The only destination is the active, verified email returned by the approved recovery service.
export async function recoverAccountAsOperator(
  db: Db,
  input: OperatorRecoveryInput,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (input.operatorConfirmed !== true) return err("confirmation_required");
  return db.transaction(async (tx) => {
    if (input.emergencyLastAdministrator === true) {
      const reviewed = await reviewEmergencyRecovery(tx, input, signal);
      if (!reviewed.ok) return reviewed;
    }
    const recovered = await completeApprovedRecovery(tx, input, signal);
    if (!recovered.ok) {
      if (input.emergencyLastAdministrator === true)
        throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "Emergency review could not be completed");
      return recovered;
    }
    await createBetterAuth(tx).api.requestPasswordReset({
      body: {
        email: recovered.value.email,
        redirectTo: new URL("/auth/reset-password", env.BASE_URL).toString(),
      },
      headers: new Headers({ origin: new URL(env.BASE_URL).origin }),
    });
    // Native reset deliberately suppresses delivery callback errors. Recovery cancelled every
    // earlier pending message, so a new pending row is required before committing this grant.
    const [queued] = await tx
      .select({ id: authMailOutbox.id })
      .from(authMailOutbox)
      .where(
        and(
          eq(authMailOutbox.userId, recovered.value.userId),
          eq(authMailOutbox.recipient, recovered.value.email),
          eq(authMailOutbox.kind, "password_reset"),
          eq(authMailOutbox.status, "pending"),
        ),
      )
      .limit(1);
    if (queued === undefined)
      throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "Recovery reset message was not queued");
    signal.throwIfAborted();
    return ok({});
  });
}
