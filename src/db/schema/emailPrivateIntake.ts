import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  PrivateIntakeConfirmationSnapshot,
  PrivateIntakeContentState,
  PrivateIntakeProvider,
  PrivateIntakeReviewDecision,
  PrivateIntakeState,
} from "@/features/email/privateIntakeTypes";
import { emailAccounts, emailMessages, emailSendAttempts } from "./email";
import { users } from "./identity";

const OBSERVED_PROVIDER_ID_BYTES = 2048;
const CONFIRMATION_SNAPSHOT_BYTES = 16 * 1024;

// SQL-only guards enforce immutable v1 evidence, exclusive synthetic-copy ownership,
// exact API-ACK confirmation, revision increments and one-way parent-copy cleanup.
// A public hint never grants acceptance or a notification/attempt association.
export const emailPrivateIntake = pgTable(
  "email_private_intake",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    provider: text("provider").$type<PrivateIntakeProvider>().notNull(),
    // Provider IDs are opaque, case-sensitive text, never citext or RFC identity.
    observedProviderId: text("observed_provider_id").notNull(),
    observedPayload: jsonb("observed_payload").$type<Record<string, unknown>>(),
    observedPayloadHash: text("observed_payload_hash").notNull(),
    hashVersion: integer("hash_version").$type<1>().notNull().default(1),
    baselineVersion: integer("baseline_version").$type<1>().notNull().default(1),
    ownedMessageId: uuid("owned_message_id"),
    // A snapshot only. Derive the current thread from the locked owned message.
    baselineThreadId: uuid("baseline_thread_id").notNull(),
    baselineMessageHash: text("baseline_message_hash").notNull(),
    baselineThreadHash: text("baseline_thread_hash").notNull(),
    baselineAttachmentsHash: text("baseline_attachments_hash").notNull(),
    confirmationAttemptId: uuid("confirmation_attempt_id"),
    confirmationSnapshot: jsonb("confirmation_snapshot").$type<PrivateIntakeConfirmationSnapshot>(),
    intakeState: text("intake_state").$type<PrivateIntakeState>().notNull().default("unverified"),
    contentState: text("content_state")
      .$type<PrivateIntakeContentState>()
      .notNull()
      .default("retained"),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("email_private_intake_id_account_uq").on(t.id, t.accountId),
    unique("email_private_intake_observed_uq").on(t.accountId, t.provider, t.observedProviderId),
    unique("email_private_intake_owned_message_uq").on(t.accountId, t.ownedMessageId),
    unique("email_private_intake_confirmation_uq").on(t.accountId, t.confirmationAttemptId),
    index("email_private_intake_account_state_idx").on(t.accountId, t.contentState, t.intakeState),
    foreignKey({
      columns: [t.ownedMessageId, t.accountId],
      foreignColumns: [emailMessages.id, emailMessages.accountId],
      name: "email_private_intake_message_same_account_fk",
      // Forward SQL must use SET NULL (owned_message_id), then purge duplicated
      // content and advance revision. Never null account_id or delete the ledger.
    }).onDelete("set null"),
    foreignKey({
      columns: [t.confirmationAttemptId, t.accountId],
      foreignColumns: [emailSendAttempts.id, emailSendAttempts.accountId],
      name: "email_private_intake_attempt_same_account_fk",
      // Forward SQL must use SET NULL (confirmation_attempt_id), preserving the
      // immutable confirmation snapshot/fact and user review disposition.
    }).onDelete("set null"),
    check("email_private_intake_provider", sql`${t.provider} IN ('gmail','imap_smtp')`),
    check(
      "email_private_intake_observed_id",
      sql`octet_length(${t.observedProviderId})
      BETWEEN 1 AND ${sql.raw(String(OBSERVED_PROVIDER_ID_BYTES))}`,
    ),
    check("email_private_intake_hash_version", sql`${t.hashVersion}=1`),
    check("email_private_intake_baseline_version", sql`${t.baselineVersion}=1`),
    check(
      "email_private_intake_hashes",
      sql`${t.observedPayloadHash} ~ '^[a-f0-9]{64}$'
      AND ${t.baselineMessageHash} ~ '^[a-f0-9]{64}$'
      AND ${t.baselineThreadHash} ~ '^[a-f0-9]{64}$'
      AND ${t.baselineAttachmentsHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "email_private_intake_state",
      sql`${t.intakeState}
      IN ('unverified','confirmed_notification','conflict')`,
    ),
    check("email_private_intake_content_state", sql`${t.contentState} IN ('retained','purged')`),
    check("email_private_intake_revision", sql`${t.revision}>=0`),
    check(
      "email_private_intake_content_shape",
      sql`((
      ${t.contentState}='retained' AND ${t.ownedMessageId} IS NOT NULL
        AND ${t.observedPayload} IS NOT NULL AND jsonb_typeof(${t.observedPayload})='object'
      ) OR (
      ${t.contentState}='purged' AND ${t.ownedMessageId} IS NULL AND ${t.observedPayload} IS NULL
      )) IS TRUE`,
    ),
    // Cross-row receipt proof and transition authority belong to the SQL guard;
    // this shape permits a retained confirmation after its attempt FK is purged.
    check(
      "email_private_intake_confirmation_shape",
      sql`((
      ${t.intakeState} IN ('unverified','conflict') AND ${t.confirmationAttemptId} IS NULL
        AND ${t.confirmationSnapshot} IS NULL
      ) OR (
      ${t.intakeState}='confirmed_notification' AND ${t.provider}='gmail'
        AND jsonb_typeof(${t.confirmationSnapshot})='object'
        AND octet_length(${t.confirmationSnapshot}::text)<=${sql.raw(String(CONFIRMATION_SNAPSHOT_BYTES))}
        AND ${t.confirmationSnapshot}->'version'='1'::jsonb
        AND jsonb_typeof(${t.confirmationSnapshot}->'accountId')='string'
        AND ${t.confirmationSnapshot}->>'accountId'=${t.accountId}::text
        AND jsonb_typeof(${t.confirmationSnapshot}->'attemptId')='string'
        AND ${t.confirmationSnapshot}->>'attemptId'
          ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        AND (${t.confirmationAttemptId} IS NULL OR
          ${t.confirmationSnapshot}->>'attemptId'=${t.confirmationAttemptId}::text)
        AND jsonb_typeof(${t.confirmationSnapshot}->'providerMessageId')='string'
        AND ${t.confirmationSnapshot}->>'providerMessageId'=${t.observedProviderId}
        AND jsonb_typeof(${t.confirmationSnapshot}->'payloadHash')='string'
        AND ${t.confirmationSnapshot}->>'payloadHash' ~ '^[a-f0-9]{64}$'
        AND (${t.confirmationSnapshot}-'version'-'accountId'-'attemptId'-'providerMessageId'-'payloadHash')='{}'::jsonb
      )) IS TRUE`,
    ),
  ],
);

// SQL-only guards allow INSERT at the new current ledger revision, reject
// UPDATE/DELETE except authenticated actor/account cleanup, and never confirm mail.
export const emailPrivateIntakeReviews = pgTable(
  "email_private_intake_reviews",
  {
    intakeId: uuid("intake_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    decision: text("decision").$type<PrivateIntakeReviewDecision>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.intakeId, t.revision], name: "email_private_intake_reviews_pk" }),
    foreignKey({
      columns: [t.intakeId, t.accountId],
      foreignColumns: [emailPrivateIntake.id, emailPrivateIntake.accountId],
      name: "email_private_intake_review_same_account_fk",
    }).onDelete("cascade"),
    check("email_private_intake_review_revision", sql`${t.revision}>0`),
    check(
      "email_private_intake_review_decision",
      sql`${t.decision}
      IN ('keep_private','dismiss','restore_private')`,
    ),
  ],
);

export type EmailPrivateIntakeRow = typeof emailPrivateIntake.$inferSelect;
export type EmailPrivateIntakeReviewRow = typeof emailPrivateIntakeReviews.$inferSelect;
