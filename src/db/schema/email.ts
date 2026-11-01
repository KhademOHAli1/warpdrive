import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  EMAIL_ACCOUNT_STATUS,
  EMAIL_MESSAGE_DIRECTION,
  EMAIL_SEND_STATUS,
  EMAIL_TRACKING_EVENT_TYPE,
  EMAIL_VISIBILITY,
} from "@/constants/email";
import {
  NOTIFICATION_SUPPRESSION_REASONS,
  type NotificationSuppressionReason,
} from "@/features/notifications/email/notificationAdmissionTypes";
import { citext, users } from "./identity";

// bytea for encrypted OAuth tokens (ops spec); never plaintext, never logged.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const emailAccountStatus = pgEnum("email_account_status", EMAIL_ACCOUNT_STATUS);
export const emailMessageDirection = pgEnum("email_message_direction", EMAIL_MESSAGE_DIRECTION);
export const emailSendStatus = pgEnum("email_send_status", EMAIL_SEND_STATUS);
export const emailVisibility = pgEnum("email_visibility", EMAIL_VISIBILITY);
export const emailTrackingEventType = pgEnum(
  "email_tracking_event_type",
  EMAIL_TRACKING_EVENT_TYPE,
);

// Gmail tokens remain in their original column during the additive provider migration.
export const emailAccounts = pgTable(
  "email_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    emailAddress: citext("email_address").notNull().unique(),
    provider: text("provider")
      .$type<"gmail" | "imap_smtp" | "microsoft">()
      .notNull()
      .default("gmail"),
    identityKey: text("identity_key").unique(),
    displayName: text("display_name"),
    isDefault: boolean("is_default").notNull().default(false),
    paused: boolean("paused").notNull().default(false),
    connectionGeneration: integer("connection_generation").notNull().default(1),
    credentialVersion: integer("credential_version").notNull().default(1),
    credentialsEnc: bytea("credentials_enc"),
    connectionSettings: jsonb("connection_settings").$type<Record<string, unknown>>(),
    historyDays: integer("history_days").notNull().default(90),
    folderPaths: jsonb("folder_paths").$type<string[]>().notNull().default([]),
    capabilities: jsonb("capabilities")
      .$type<{
        read: boolean;
        send: boolean;
        markRead: boolean;
        move: boolean;
        trash: boolean;
      }>()
      .notNull()
      .default({ read: true, send: true, markRead: false, move: false, trash: true }),
    refreshTokenEnc: bytea("refresh_token_enc"),
    scopes: jsonb("scopes").notNull().default("[]"),
    lastHistoryId: text("last_history_id"),
    watchExpiresAt: timestamp("watch_expires_at", { withTimezone: true }),
    status: emailAccountStatus("status").notNull().default("connected"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastErrorId: text("last_error_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_accounts_owner_idx").on(t.userId),
    uniqueIndex("email_accounts_default_owner_uq").on(t.userId).where(sql`${t.isDefault} = true`),
  ],
);

// Composite UNIQUE (id, account_id) anchors child composite FKs to the same mailbox.
export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gmailThreadId: text("gmail_thread_id"),
    providerThreadId: text("provider_thread_id"),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id),
    subject: text("subject"),
    dealId: uuid("deal_id"),
    // Lead-scoped thread link (Leads Inbox email timeline). Untyped uuid, mirroring dealId.
    leadId: uuid("lead_id"),
    personId: uuid("person_id"),
    visibility: emailVisibility("visibility").notNull().default("private"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    // Local CRM archive flag (D2). Null = active (shows in Inbox); non-null = archived
    // (shows in Archive). No Gmail label write. Filtered by the partial index below.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Gone-from-the-Gmail-mailbox flag (P4). Non-null once Gmail no longer shows the conversation
    // in the live mailbox: moved to Trash (the reader Delete action, or an observed TRASH label) or
    // classified as Spam (observed SPAM label; spam arrives as an ordinary new message, so nothing
    // else keeps it out of the Inbox). Excluded from every local folder read so such a thread leaves
    // all views, and cleared when Gmail restores it (untrash / "not spam"). Unlike archivedAt this
    // mirrors real Gmail state rather than a local CRM preference.
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    remoteTrashedAt: timestamp("remote_trashed_at", { withTimezone: true }),
    // Reader follow-up controls (B1), local only (no Gmail label write). Nullable status:
    // null means unset, distinct from the explicit "none" constant value.
    followUpStatus: text("follow_up_status"),
    labels: text("labels").array().notNull().default(sql`'{}'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_thread_acct_gmail").on(t.accountId, t.gmailThreadId),
    unique("email_thread_provider_key_uq").on(t.accountId, t.providerThreadId),
    check(
      "email_thread_remote_identity_required",
      sql`${t.providerThreadId} IS NOT NULL OR ${t.gmailThreadId} IS NOT NULL`,
    ),
    // Composite target so children can pin messages/attempts to the SAME mailbox.
    unique("uq_thread_id_acct").on(t.id, t.accountId),
    // Partial index backs the not-archived Inbox read (WHERE archived_at IS NULL).
    index("email_threads_not_archived_idx")
      .on(t.accountId, t.lastMessageAt)
      .where(sql`archived_at IS NULL`),
  ],
);

// Composite FK (thread_id, account_id) -> emailThreads prevents cross-mailbox body exposure.
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id").notNull(),
    accountId: uuid("account_id").notNull(),
    gmailMessageId: text("gmail_message_id"),
    providerMessageId: text("provider_message_id"),
    rfcMessageId: text("rfc_message_id"),
    inReplyTo: text("in_reply_to"),
    references: text("references").array().notNull().default(sql`'{}'::text[]`),
    messageFingerprint: text("message_fingerprint"),
    direction: emailMessageDirection("direction").notNull(),
    fromEmail: citext("from_email").notNull(),
    // Sender display name parsed from the From header ("Scrape.do Team"), null for a bare address.
    // The list row + reader show this and fall back to from_email when absent.
    fromName: text("from_name"),
    toEmails: jsonb("to_emails").notNull().default("[]"),
    ccEmails: jsonb("cc_emails").notNull().default("[]"),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    trackingEnabled: boolean("tracking_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_msg_acct_gmail").on(t.accountId, t.gmailMessageId),
    unique("email_messages_id_account_uq").on(t.id, t.accountId),
    unique("email_message_provider_key_uq").on(t.accountId, t.providerMessageId),
    unique("email_message_source_fingerprint_uq").on(t.accountId, t.messageFingerprint),
    check(
      "email_message_remote_identity_required",
      sql`${t.providerMessageId} IS NOT NULL OR ${t.gmailMessageId} IS NOT NULL`,
    ),
    foreignKey({
      columns: [t.threadId, t.accountId],
      foreignColumns: [emailThreads.id, emailThreads.accountId],
      name: "fk_msg_thread_same_mailbox",
    }).onDelete("cascade"),
  ],
);

// Outbound idempotency / outbox. A row exists before the Gmail send call.
export const emailSendAttempts = pgTable(
  "email_send_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    messageIdHeader: text("message_id_header").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id),
    threadId: uuid("thread_id"),
    payload: jsonb("payload").notNull(),
    payloadPrepared: boolean("payload_prepared").notNull().default(true),
    status: emailSendStatus("status").notNull().default("pending"),
    claimToken: uuid("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sendStartedAt: timestamp("send_started_at", { withTimezone: true }),
    gmailMessageId: text("gmail_message_id"),
    providerMessageId: text("provider_message_id"),
    connectionGeneration: integer("connection_generation"),
    deliveryOutcome: jsonb("delivery_outcome").$type<
      | {
          state: "accepted" | "partial" | "unknown" | "rejected";
          accepted?: string[];
          rejected?: string[];
        }
      | {
          version: 1;
          provider: "gmail";
          state: "accepted";
          evidence: "api_ack";
          providerMessageId: string;
          accepted?: never;
          rejected?: never;
        }
    >(),
    errorId: text("error_id"),
    notificationSuppressedAt: timestamp("notification_suppressed_at", { withTimezone: true }),
    notificationSuppressionReason: text(
      "notification_suppression_reason",
    ).$type<NotificationSuppressionReason>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  },
  (t) => [
    unique("uq_attempt_acct_key").on(t.accountId, t.idempotencyKey),
    unique("uq_attempt_msgid").on(t.messageIdHeader),
    unique("email_send_attempts_id_account_uq").on(t.id, t.accountId),
    uniqueIndex("email_send_attempts_notification_purpose_uq")
      .on(
        sql`(${t.payload}->'systemPurpose'->>'notificationId')`,
        sql`(${t.payload}->'systemPurpose'->>'recipientUserId')`,
      )
      .where(sql`${t.payload}->'systemPurpose'->>'kind'='notification'
        AND ${t.payload}->'systemPurpose'->>'version'='1'`),
    check(
      "email_attempt_notification_suppression_pair",
      sql`((${t.notificationSuppressedAt} IS NULL AND ${t.notificationSuppressionReason} IS NULL)
        OR (${t.notificationSuppressedAt} IS NOT NULL AND ${t.notificationSuppressionReason}
          IN (${sql.join(
            NOTIFICATION_SUPPRESSION_REASONS.map((reason) => sql`${reason}`),
            sql`, `,
          )}))) IS TRUE`.inlineParams(),
    ),
    // Composite FK pins a reply attempt to the same mailbox as the thread.
    foreignKey({
      columns: [t.threadId, t.accountId],
      foreignColumns: [emailThreads.id, emailThreads.accountId],
      name: "fk_attempt_thread_same_mailbox",
    }),
  ],
);

// Tracking tokens minted before MIME build; anchored to send_attempt, not message.
export const emailTrackingTokens = pgTable(
  "email_tracking_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: text("token").notNull().unique(),
    sendAttemptId: uuid("send_attempt_id")
      .notNull()
      .references(() => emailSendAttempts.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => emailMessages.id),
    recipient: citext("recipient").notNull(),
    kind: emailTrackingEventType("kind").notNull(),
    targetUrl: text("target_url"),
    disabled: boolean("disabled").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ett_send_attempt_idx").on(t.sendAttemptId),
    index("ett_message_idx").on(t.messageId),
  ],
);

// One row per actual open/click hit. token_id FK cascades on token delete.
export const emailTrackingEvents = pgTable(
  "email_tracking_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => emailTrackingTokens.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => emailMessages.id),
    eventType: emailTrackingEventType("event_type").notNull(),
    recipient: citext("recipient").notNull(),
    targetUrl: text("target_url"),
    userAgent: text("user_agent"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ete_message_occurred_idx").on(t.messageId, t.occurredAt)],
);

export type EmailAccount = typeof emailAccounts.$inferSelect;
export type NewEmailAccount = typeof emailAccounts.$inferInsert;
export type EmailThread = typeof emailThreads.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type EmailSendAttempt = typeof emailSendAttempts.$inferSelect;
