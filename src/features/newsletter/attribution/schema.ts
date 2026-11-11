import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { deals } from "@/db/schema/deals";
import { leads } from "@/db/schema/leads";
import { persons } from "@/db/schema/persons";
import { newsletterPersonAddresses } from "@/features/newsletter/schema/personAddresses";

export const newsletterExposureReceipts = pgTable(
  "newsletter_exposure_receipts",
  {
    id: uuid("id").primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => newsletterPersonAddresses.id, { onDelete: "cascade" }),
    campaignId: integer("campaign_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    purposeListId: integer("purpose_list_id").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (row) => [index("newsletter_exposure_receipts_person_idx").on(row.personId, row.acceptedAt)],
);

export const newsletterLeadSources = pgTable(
  "newsletter_lead_sources",
  {
    leadId: uuid("lead_id")
      .primaryKey()
      .references(() => leads.id, { onDelete: "cascade" }),
    exposureId: uuid("exposure_id")
      .notNull()
      .references(() => newsletterExposureReceipts.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id"),
    operationId: uuid("operation_id"),
    intentFingerprint: text("intent_fingerprint"),
  },
  (row) => [
    unique("newsletter_lead_sources_operation_uidx").on(row.actorId, row.operationId),
    check(
      "newsletter_lead_sources_intent_ck",
      sql`
    (${row.actorId} IS NULL AND ${row.operationId} IS NULL AND ${row.intentFingerprint} IS NULL)
    OR (${row.actorId} IS NOT NULL AND ${row.operationId} IS NOT NULL
        AND ${row.intentFingerprint} IS NOT NULL AND ${row.intentFingerprint} ~ '^[0-9a-f]{64}$')
  `,
    ),
  ],
);

export const newsletterDealSources = pgTable("newsletter_deal_sources", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => deals.id, { onDelete: "cascade" }),
  exposureId: uuid("exposure_id")
    .notNull()
    .references(() => newsletterExposureReceipts.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
});

export const newsletterAttributedWins = pgTable("newsletter_attributed_wins", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => newsletterDealSources.dealId, { onDelete: "cascade" }),
  id: uuid("id").notNull().defaultRandom().unique(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});
