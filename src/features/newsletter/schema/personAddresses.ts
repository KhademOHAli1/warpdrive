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
import { persons } from "@/db/schema/persons";

const digest = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const newsletterPersonAddresses = pgTable(
  "newsletter_person_addresses",
  {
    id: uuid("id").primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    addressDigest: digest("address_digest").notNull(),
    subscriberId: integer("subscriber_id"),
    subscriberUuid: uuid("subscriber_uuid"),
    actorId: uuid("actor_id").notNull(),
    evidenceReference: text("evidence_reference").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    detachedAt: timestamp("detached_at", { withTimezone: true }),
    detachedReason: text("detached_reason").$type<NewsletterDetachReason>(),
  },
  (t) => [
    check("newsletter_person_address_digest_ck", sql`octet_length(${t.addressDigest}) = 32`),
    check(
      "newsletter_person_address_proof_ck",
      sql`
      (${t.subscriberId} IS NULL AND ${t.subscriberUuid} IS NULL AND ${t.verifiedAt} IS NULL)
      OR (${t.subscriberId} > 0 AND ${t.subscriberUuid} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL)
    `,
    ),
    check(
      "newsletter_person_address_detach_ck",
      sql`
      (${t.detachedAt} IS NULL AND ${t.detachedReason} IS NULL)
      OR (${t.detachedAt} IS NOT NULL AND ${t.detachedReason} IS NOT NULL AND
        ${t.detachedReason} IN ('address_removed', 'person_archived', 'person_merged', 'operator', 'expired', 'shared', 'erasure', 'suppressed'))
    `,
    ),
    uniqueIndex("newsletter_person_active_address_idx")
      .on(t.personId, t.addressDigest)
      .where(sql`${t.detachedAt} IS NULL`),
    index("newsletter_person_proof_pending_idx")
      .on(t.nextCheckAt, t.id)
      .where(sql`${t.verifiedAt} IS NULL AND ${t.detachedAt} IS NULL`),
    index("newsletter_person_mailbox_idx").on(t.subscriberUuid).where(sql`${t.detachedAt} IS NULL`),
  ],
);

export type NewsletterDetachReason =
  | "address_removed"
  | "person_archived"
  | "person_merged"
  | "operator"
  | "expired"
  | "shared"
  | "erasure"
  | "suppressed";

export const newsletterIdentityCommands = pgTable(
  "newsletter_identity_commands",
  {
    id: uuid("id").primaryKey(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => newsletterPersonAddresses.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").notNull(),
    kind: text("kind").notNull().$type<"invite" | "erase">(),
    listId: integer("list_id"),
    originRunId: uuid("origin_run_id"),
    privacyCaseId: uuid("privacy_case_id"),
    approvedScopeVersion: integer("approved_scope_version"),
    approvedRecipientVersion: integer("approved_recipient_version"),
    approvedVerificationVersion: integer("approved_verification_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    state: text("state")
      .notNull()
      .default("pending")
      .$type<"pending" | "confirmed" | "erased" | "expired" | "suppressed" | "detached">(),
  },
  (t) => [
    index("newsletter_identity_pending_idx")
      .on(t.nextCheckAt, t.id)
      .where(sql`${t.state} = 'pending'`),
    index("newsletter_identity_command_link_idx").on(t.linkId, t.createdAt),
    check(
      "newsletter_identity_command_kind_ck",
      sql`
      (${t.kind} = 'invite' AND ${t.listId} IS NOT NULL AND ${t.listId} > 0 AND ${t.privacyCaseId} IS NULL AND ${t.state} <> 'erased')
      OR (${t.kind} = 'erase' AND ${t.listId} IS NULL AND ${t.privacyCaseId} IS NOT NULL AND ${t.state} <> 'confirmed')
    `,
    ),
    check(
      "newsletter_identity_command_approval_ck",
      sql`
      (${t.kind} = 'invite' AND ${t.approvedScopeVersion} IS NULL AND ${t.approvedRecipientVersion} IS NULL AND ${t.approvedVerificationVersion} IS NULL)
      OR (${t.kind} = 'erase' AND ${t.approvedScopeVersion} IS NOT NULL AND ${t.approvedRecipientVersion} IS NOT NULL AND ${t.approvedVerificationVersion} IS NOT NULL)
    `,
    ),
    check(
      "newsletter_identity_command_state_ck",
      sql`
      (${t.state} = 'pending' AND ${t.resolvedAt} IS NULL)
      OR (${t.state} IN ('confirmed', 'erased', 'expired', 'suppressed', 'detached') AND ${t.resolvedAt} IS NOT NULL)
    `,
    ),
  ],
);

export const newsletterPersonEvents = pgTable(
  "newsletter_person_events",
  {
    id: uuid("id").primaryKey(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => newsletterPersonAddresses.id, { onDelete: "cascade" }),
    listId: integer("list_id"),
    originRunId: uuid("origin_run_id"),
    event: text("event")
      .notNull()
      .$type<"newsletter.identity.verified" | "newsletter.consent.confirmed">(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    index("newsletter_person_events_link_idx").on(t.linkId, t.occurredAt),
    index("newsletter_person_events_delivery_idx")
      .on(t.occurredAt, t.id)
      .where(sql`${t.deliveredAt} IS NULL`),
    check(
      "newsletter_person_event_type_ck",
      sql`
      (${t.event} = 'newsletter.identity.verified' AND ${t.listId} IS NULL)
      OR (${t.event} = 'newsletter.consent.confirmed' AND ${t.listId} IS NOT NULL AND ${t.listId} > 0)
    `,
    ),
  ],
);
