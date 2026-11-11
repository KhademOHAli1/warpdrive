import { sql } from "drizzle-orm";
import { boolean, check, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** One opaque namespace for the primary engine; never store credentials or URLs. */
export const newsletterOperationalState = pgTable(
  "newsletter_operational_state",
  {
    engineKey: text("engine_key").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    incidentOpen: boolean("incident_open").notNull().default(false),
    problem: text("problem"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("newsletter_operational_engine_key_ck", sql`${table.engineKey} ~ '^[0-9a-f]{64}$'`),
    check(
      "newsletter_operational_fingerprint_ck",
      sql`char_length(${table.fingerprint}) between 1 and 160 AND ${table.fingerprint} ~ '^[a-z_/]+$'`,
    ),
    check(
      "newsletter_operational_problem_ck",
      sql`${table.problem} IS NULL OR (char_length(${table.problem}) between 1 and 160 AND ${table.problem} ~ '^[a-z_/]+$')`,
    ),
  ],
);

/** A receipt survives a lost engine ACK. It contains only opaque event identity and fixed codes. */
export const newsletterOperationalReceipts = pgTable(
  "newsletter_operational_receipts",
  {
    engineKey: text("engine_key").notNull(),
    eventId: uuid("event_id").notNull(),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    occurredAt: text("occurred_at").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "newsletter_operational_receipts_pkey",
      columns: [table.engineKey, table.eventId],
    }),
    check("newsletter_operational_receipt_engine_ck", sql`${table.engineKey} ~ '^[0-9a-f]{64}$'`),
    check(
      "newsletter_operational_receipt_at_ck",
      sql`char_length(${table.occurredAt}) between 20 and 40`,
    ),
    check(
      "newsletter_operational_receipt_kind_ck",
      sql`${table.kind} IN ('delivery.failed','delivery.uncertain','delivery.resolved','feedback.bounce','feedback.complaint')`,
    ),
    check(
      "newsletter_operational_receipt_reason_ck",
      sql`${table.reason} IN ('delivery_rejected','submission_unknown','operator_accepted','operator_rejected','provider_accepted','hard_bounce','soft_bounce','unmatched_bounce','complaint','unmatched_complaint')`,
    ),
  ],
);
