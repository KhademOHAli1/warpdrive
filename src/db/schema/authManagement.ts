import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, users } from "./identity";

const encrypted = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const authInvitations = pgTable(
  "auth_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    email: citext("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    locale: text("locale").notNull().default("en"),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("auth_invitation_user_idx").on(t.userId),
    check("auth_invitation_locale", sql`${t.locale} IN ('en','fa','de')`),
  ],
);

// Bearer links exist only inside authenticated encryption for the delivery worker, never in admin DTOs.
export const authMailOutbox = pgTable(
  "auth_mail_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    invitationId: uuid("invitation_id").references(() => authInvitations.id),
    recipient: citext("recipient").notNull(),
    kind: text("kind").notNull(),
    locale: text("locale").notNull(),
    payloadEnc: encrypted("payload_enc").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    claimId: uuid("claim_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("auth_mail_dispatch_idx").on(t.status, t.nextAttemptAt),
    check(
      "auth_mail_status",
      sql`${t.status} IN ('pending','sending','sent','failed','captured','cancelled')`,
    ),
  ],
);

export const authPolicies = pgTable(
  "auth_policies",
  {
    id: boolean("id").primaryKey().default(true),
    requireMfaForAll: boolean("require_mfa_for_all").notNull().default(false),
    idleMinutes: integer("idle_minutes").notNull().default(30),
    absoluteHours: integer("absolute_hours").notNull().default(168),
    freshMinutes: integer("fresh_minutes").notNull().default(5),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("auth_policy_singleton", sql`${t.id} = true`),
    check(
      "auth_policy_limits",
      sql`${t.idleMinutes} BETWEEN 5 AND 1440 AND ${t.absoluteHours} BETWEEN 1 AND 720 AND ${t.freshMinutes} BETWEEN 1 AND 15 AND ${t.freshMinutes} <= ${t.idleMinutes}`,
    ),
  ],
);

export const authSecurityEvents = pgTable(
  "auth_security_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").references(() => users.id),
    targetUserId: uuid("target_user_id").references(() => users.id),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("auth_security_event_time_idx").on(t.createdAt),
    index("auth_security_event_user_idx").on(t.targetUserId, t.createdAt),
  ],
);

export const authRecoveryRequests = pgTable(
  "auth_recovery_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    reasonEnc: encrypted("reason_enc"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("auth_recovery_request_idx").on(t.userId, t.status),
    check("auth_recovery_kind", sql`${t.kind} IN ('factor_recovery','account_closure')`),
    check("auth_recovery_status", sql`${t.status} IN ('pending','approved','rejected','resolved')`),
  ],
);

// External consent revocation is retried independently after local access is already disabled.
export const authIntegrationRevocations = pgTable(
  "auth_integration_revocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    tokenEnc: encrypted("token_enc"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    claimId: uuid("claim_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_integration_revoke_status_idx").on(t.status, t.nextAttemptAt)],
);
