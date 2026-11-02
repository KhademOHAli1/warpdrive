import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DELIVERY_REPORT_LIMITS,
  type ParsedDeliveryReport,
} from "@/features/email/deliveryReportTypes";
import { emailAccounts, emailMessages, emailSendAttempts } from "./email";
import { users } from "./identity";

const PART_KEY_BYTES = 2048;
const PARSED_REPORT_BYTES = DELIVERY_REPORT_LIMITS.messageBytes * 8;
const RECIPIENT_SNAPSHOT_BYTES = 4096;

// Source evidence and review history never become SMTP submission authority.
// SQL-only update guards belong to the forward migration; deletion follows privacy cascades.
export const emailDeliveryReports = pgTable(
  "email_delivery_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id").notNull(),
    partKey: text("part_key").notNull(),
    mediaType: text("media_type").$type<ParsedDeliveryReport["mediaType"]>().notNull(),
    provenance: text("provenance").$type<ParsedDeliveryReport["provenance"]>().notNull(),
    contentHash: text("content_hash").notNull(),
    contentBytes: integer("content_bytes").notNull(),
    parsed: jsonb("parsed").$type<ParsedDeliveryReport>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("email_delivery_reports_id_account_uq").on(t.id, t.accountId),
    unique("email_delivery_reports_source_part_uq").on(t.accountId, t.sourceMessageId, t.partKey),
    foreignKey({
      columns: [t.sourceMessageId, t.accountId],
      foreignColumns: [emailMessages.id, emailMessages.accountId],
      name: "email_delivery_report_source_same_account_fk",
    }).onDelete("cascade"),
    check(
      "email_delivery_report_part_key",
      sql`octet_length(${t.partKey}) BETWEEN 1 AND ${sql.raw(String(PART_KEY_BYTES))}
        AND ${t.partKey} ~ '^[0-9]+([.!][0-9]+)*$'`,
    ),
    check(
      "email_delivery_report_media_type",
      sql`${t.mediaType} IN ('message/delivery-status','message/global-delivery-status')`,
    ),
    check(
      "email_delivery_report_provenance",
      sql`${t.provenance} IN ('direct','nested','forwarded')`,
    ),
    check("email_delivery_report_content_hash", sql`${t.contentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "email_delivery_report_content_bytes",
      sql`${t.contentBytes} BETWEEN 1 AND ${sql.raw(String(DELIVERY_REPORT_LIMITS.messageBytes))}`,
    ),
    check(
      "email_delivery_report_untrusted_shape",
      sql`(jsonb_typeof(${t.parsed})='object'
        AND octet_length(${t.parsed}::text) <= ${sql.raw(String(PARSED_REPORT_BYTES))}
        AND ${t.parsed}->>'trust'='unverified'
        AND ${t.parsed}->'requiresReview'='true'::jsonb
        AND ${t.parsed}->'correlationAuthority'='false'::jsonb
        AND ${t.parsed}->>'mediaType'=${t.mediaType}
        AND ${t.parsed}->>'provenance'=${t.provenance}
        AND jsonb_typeof(${t.parsed}->'recipients')='array'
        AND jsonb_array_length(${t.parsed}->'recipients') BETWEEN 1 AND ${sql.raw(String(DELIVERY_REPORT_LIMITS.recipientBlocks))}) IS TRUE`,
    ),
  ],
);

export const emailDeliveryReviews = pgTable(
  "email_delivery_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull(),
    recipientIndex: integer("recipient_index").notNull(),
    revision: integer("revision").notNull(),
    decision: text("decision").$type<"associate" | "dismiss">().notNull(),
    attemptId: uuid("attempt_id"),
    recipientSnapshot: jsonb("recipient_snapshot").$type<{
      address: string;
      kind: "to" | "cc" | "bcc";
    }>(),
    attemptSnapshotHash: text("attempt_snapshot_hash"),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("email_delivery_review_revision_uq").on(t.reportId, t.recipientIndex, t.revision),
    index("email_delivery_review_attempt_idx").on(t.accountId, t.attemptId),
    foreignKey({
      columns: [t.reportId, t.accountId],
      foreignColumns: [emailDeliveryReports.id, emailDeliveryReports.accountId],
      name: "email_delivery_review_report_same_account_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.attemptId, t.accountId],
      foreignColumns: [emailSendAttempts.id, emailSendAttempts.accountId],
      name: "email_delivery_review_attempt_same_account_fk",
      // Migration92 must use SET NULL (attempt_id), which the schema DSL cannot express.
      // Clearing account_id or deleting history would destroy the review CAS sequence.
    }).onDelete("set null"),
    check(
      "email_delivery_review_recipient_index",
      sql`${t.recipientIndex} >= 0 AND ${t.recipientIndex} < ${sql.raw(String(DELIVERY_REPORT_LIMITS.recipientBlocks))}`,
    ),
    check("email_delivery_review_revision", sql`${t.revision} > 0`),
    check("email_delivery_review_decision", sql`${t.decision} IN ('associate','dismiss')`),
    check(
      "email_delivery_review_target_shape",
      sql`((${t.decision}='dismiss' AND ${t.attemptId} IS NULL
        AND ${t.recipientSnapshot} IS NULL AND ${t.attemptSnapshotHash} IS NULL)
        OR (${t.decision}='associate'
          AND ${t.attemptSnapshotHash} IS NOT NULL
          AND ${t.recipientSnapshot} IS NOT NULL
          AND ${t.attemptSnapshotHash} ~ '^[a-f0-9]{64}$'
          AND jsonb_typeof(${t.recipientSnapshot})='object'
          AND octet_length(${t.recipientSnapshot}::text) <= ${sql.raw(String(RECIPIENT_SNAPSHOT_BYTES))}
          AND ${t.recipientSnapshot} ?& ARRAY['address','kind']
          AND (${t.recipientSnapshot}-'address'-'kind')='{}'::jsonb
          AND jsonb_typeof(${t.recipientSnapshot}->'address')='string'
          AND length(${t.recipientSnapshot}->>'address') > 0
          AND position(chr(10) in ${t.recipientSnapshot}->>'address')=0
          AND position(chr(13) in ${t.recipientSnapshot}->>'address')=0
          AND ${t.recipientSnapshot}->>'kind' IN ('to','cc','bcc'))) IS TRUE`,
    ),
  ],
);

export type EmailDeliveryReportRow = typeof emailDeliveryReports.$inferSelect;
export type EmailDeliveryReviewRow = typeof emailDeliveryReviews.$inferSelect;
