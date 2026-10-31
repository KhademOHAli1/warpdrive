import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sessions, users } from "./identity";
import { privacyCases, privacyEncrypted } from "./privacyCases";

export const privacyJobs = pgTable(
  "privacy_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => privacyCases.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    originatingSessionId: uuid("originating_session_id")
      .notNull()
      .references(() => sessions.id),
    authorityGeneration: integer("authority_generation").notNull(),
    memberGeneration: integer("member_generation").notNull(),
    scopeVersion: integer("scope_version").notNull(),
    policyVersion: integer("policy_version"),
    activePolicyVersion: integer("active_policy_version"),
    policyGeneration: integer("policy_generation").notNull().default(0),
    recipientVersion: integer("recipient_version").notNull(),
    verificationVersion: integer("verification_version").notNull(),
    claimToken: uuid("claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    resultEnc: privacyEncrypted("result_enc"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("privacy_job_command_uq").on(t.caseId, t.kind, t.idempotencyKey),
    index("privacy_job_claim_idx").on(t.status, t.leaseUntil),
    check(
      "privacy_job_kind",
      sql`${t.kind} IN ('discovery','export','erasure','closure','correction','restriction','retention')`,
    ),
    check(
      "privacy_job_status",
      sql`${t.status} IN ('queued','running','needs_attention','succeeded','failed','cancelled')`,
    ),
    check(
      "privacy_job_versions",
      sql`${t.authorityGeneration} > 0 AND ${t.memberGeneration} > 0 AND ${t.scopeVersion} > 0 AND ${t.recipientVersion} > 0 AND ${t.verificationVersion} > 0 AND (${t.policyVersion} IS NULL OR ${t.policyVersion} > 0) AND (${t.activePolicyVersion} IS NULL OR ${t.activePolicyVersion} > 0) AND ${t.policyGeneration} >= 0 AND ${t.attempts} >= 0`,
    ),
  ],
);
