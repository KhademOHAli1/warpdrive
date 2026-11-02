import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const privacyEncrypted = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const privacyCases = pgTable(
  "privacy_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("received"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    requesterUserId: uuid("requester_user_id").references(() => users.id),
    intakeKey: text("intake_key").notNull(),
    intakeDigest: text("intake_digest").notNull(),
    metadataEnc: privacyEncrypted("metadata_enc").notNull(),
    version: integer("version").notNull().default(1),
    scopeVersion: integer("scope_version").notNull().default(1),
    policyVersion: integer("policy_version"),
    recipientVersion: integer("recipient_version").notNull().default(1),
    verificationVersion: integer("verification_version").notNull().default(1),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    responseRecordedAt: timestamp("response_recorded_at", { withTimezone: true }),
    unresolvedObligations: integer("unresolved_obligations").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("privacy_case_intake_uq").on(t.createdBy, t.intakeKey),
    index("privacy_case_queue_idx").on(t.status, t.dueAt),
    check(
      "privacy_case_kind",
      sql`${t.kind} IN ('access','portability','correction','restriction','objection','closure','erasure')`,
    ),
    check(
      "privacy_case_status",
      sql`${t.status} IN ('received','verification_needed','under_review','action_approved','running','needs_attention','refused','response_ready','responded','closed','cancelled')`,
    ),
    check(
      "privacy_case_versions",
      sql`${t.version} > 0 AND ${t.scopeVersion} > 0 AND ${t.recipientVersion} > 0 AND ${t.verificationVersion} > 0 AND (${t.policyVersion} IS NULL OR ${t.policyVersion} > 0) AND ${t.unresolvedObligations} >= 0`,
    ),
  ],
);

// Routine events contain identifiers and state only. Sensitive reasons belong in authenticated ciphertext.
export const privacyCaseEvents = pgTable(
  "privacy_case_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => privacyCases.id),
    caseVersion: integer("case_version").notNull(),
    commandId: text("command_id").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    detailEnc: privacyEncrypted("detail_enc"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("privacy_case_event_command_uq").on(t.caseId, t.commandId),
    uniqueIndex("privacy_case_event_version_uq").on(t.caseId, t.caseVersion),
    check("privacy_case_event_version", sql`${t.caseVersion} > 0`),
  ],
);
