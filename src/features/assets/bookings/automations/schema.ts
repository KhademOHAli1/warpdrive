import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directorySites } from "@/features/locations/schema";
import type { BookingHandoverNotice } from "../handover/contracts";
import { assetBookingHandoverNotices } from "../handover/schema";
import { assetBookingEvents, assetBookings } from "../schema";
import type {
  BookingAutomationOutcome,
  BookingAutomationReason,
  BookingAutomationState,
  BookingAutomationTrigger,
} from "./contracts";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const assetBookingAutomationProfiles = pgTable(
  "asset_booking_automation_profiles",
  {
    siteId: uuid("site_id")
      .primaryKey()
      .references(() => directorySites.id),
    principalId: uuid("principal_id").notNull().defaultRandom(),
    version: integer("version").notNull(),
    sentBackEnabledAt: instant("sent_back_enabled_at"),
    overdueEnabledAt: instant("overdue_enabled_at"),
    pickupExpiredEnabledAt: instant("pickup_expired_enabled_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (row) => [
    unique("asset_booking_automation_principal_key").on(row.principalId),
    unique("asset_booking_automation_site_principal_key").on(row.siteId, row.principalId),
    check(
      "asset_booking_automation_profile_revision_check",
      sql`${row.version} > 0 AND ${row.createdAt} <= ${row.updatedAt}
      AND (${row.sentBackEnabledAt} IS NULL OR ${row.sentBackEnabledAt} BETWEEN ${row.createdAt} AND ${row.updatedAt})
      AND (${row.overdueEnabledAt} IS NULL OR ${row.overdueEnabledAt} BETWEEN ${row.createdAt} AND ${row.updatedAt})
      AND (${row.pickupExpiredEnabledAt} IS NULL OR ${row.pickupExpiredEnabledAt} BETWEEN ${row.createdAt} AND ${row.updatedAt})`,
    ),
  ],
);

export const assetBookingAutomationRuns = pgTable(
  "asset_booking_automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    principalId: uuid("principal_id").notNull(),
    bookingId: uuid("booking_id").notNull(),
    recipientId: uuid("recipient_id").references(() => users.id, { onDelete: "set null" }),
    trigger: text("trigger").$type<BookingAutomationTrigger>().notNull(),
    sourceVersion: integer("source_version"),
    dueAt: instant("due_at"),
    handoverKind: text("handover_kind").$type<BookingHandoverNotice["kind"]>(),
    scheduledAt: instant("scheduled_at").notNull(),
    state: text("state").$type<BookingAutomationState>().notNull().default("pending"),
  },
  (row) => [
    unique("asset_booking_automation_run_site_key").on(row.siteId, row.id),
    uniqueIndex("asset_booking_automation_review_source_key")
      .on(row.bookingId, row.sourceVersion)
      .where(sql`${row.sourceVersion} IS NOT NULL`),
    uniqueIndex("asset_booking_automation_handover_source_key")
      .on(row.bookingId, row.dueAt, row.handoverKind)
      .where(sql`${row.dueAt} IS NOT NULL`),
    index("asset_booking_automation_runs_site_idx").on(row.siteId, row.scheduledAt, row.id),
    index("asset_booking_automation_runs_pending_idx")
      .on(row.scheduledAt, row.id)
      .where(sql`${row.state} = 'pending'`),
    index("asset_booking_automation_runs_recipient_idx")
      .on(row.recipientId, row.bookingId, row.id)
      .where(sql`${row.state} = 'delivered'`),
    foreignKey({
      name: "asset_booking_automation_run_principal_fk",
      columns: [row.siteId, row.principalId],
      foreignColumns: [
        assetBookingAutomationProfiles.siteId,
        assetBookingAutomationProfiles.principalId,
      ],
    }),
    foreignKey({
      name: "asset_booking_automation_run_booking_fk",
      columns: [row.siteId, row.bookingId],
      foreignColumns: [assetBookings.siteId, assetBookings.id],
    }),
    foreignKey({
      name: "asset_booking_automation_run_review_fk",
      columns: [row.bookingId, row.sourceVersion],
      foreignColumns: [assetBookingEvents.bookingId, assetBookingEvents.version],
    }),
    foreignKey({
      name: "asset_booking_automation_run_handover_fk",
      columns: [row.bookingId, row.dueAt, row.handoverKind],
      foreignColumns: [
        assetBookingHandoverNotices.bookingId,
        assetBookingHandoverNotices.dueAt,
        assetBookingHandoverNotices.kind,
      ],
    }),
    check(
      "asset_booking_automation_run_state_check",
      sql`${row.state} IN ('pending','delivered','failed','skipped')`,
    ),
    check(
      "asset_booking_automation_run_source_check",
      sql`CASE ${row.trigger}
      WHEN 'request_sent_back' THEN ${row.sourceVersion} IS NOT NULL AND ${row.sourceVersion} > 0
        AND ${row.dueAt} IS NULL AND ${row.handoverKind} IS NULL
      WHEN 'return_overdue' THEN ${row.sourceVersion} IS NULL AND ${row.dueAt} IS NOT NULL AND ${row.dueAt} <= ${row.scheduledAt}
        AND ${row.handoverKind} IS NOT DISTINCT FROM 'overdue'
      WHEN 'pickup_expired' THEN ${row.sourceVersion} IS NULL AND ${row.dueAt} IS NOT NULL AND ${row.dueAt} <= ${row.scheduledAt}
        AND ${row.handoverKind} IS NOT DISTINCT FROM 'expired'
      ELSE false END`,
    ),
  ],
);

export const assetBookingAutomationAttempts = pgTable(
  "asset_booking_automation_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    runId: uuid("run_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    at: instant("at").notNull(),
    outcome: text("outcome").$type<BookingAutomationOutcome>().notNull(),
    reason: text("reason").$type<BookingAutomationReason>(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  },
  (row) => [
    unique("asset_booking_automation_attempt_ordinal_key").on(row.runId, row.ordinal),
    uniqueIndex("asset_booking_automation_attempt_delivered_key")
      .on(row.runId)
      .where(sql`${row.outcome} = 'delivered'`),
    foreignKey({
      name: "asset_booking_automation_attempt_run_fk",
      columns: [row.siteId, row.runId],
      foreignColumns: [assetBookingAutomationRuns.siteId, assetBookingAutomationRuns.id],
    }),
    check(
      "asset_booking_automation_attempt_outcome_check",
      sql`${row.ordinal} > 0 AND CASE ${row.outcome}
      WHEN 'delivered' THEN ${row.reason} IS NULL
      WHEN 'failed' THEN ${row.reason} IS NOT DISTINCT FROM 'temporary'
      WHEN 'skipped' THEN ${row.reason} IS NOT NULL AND ${row.reason} IN ('recipient_unavailable','rule_disabled','superseded')
      ELSE false END`,
    ),
  ],
);

export const assetBookingAutomationReceipts = pgTable(
  "asset_booking_automation_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    requestId: uuid("request_id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    kind: text("kind").$type<"save_profile" | "retry">().notNull(),
    runId: uuid("run_id"),
    fingerprint: text("fingerprint").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (row) => [
    unique("asset_booking_automation_receipt_actor_request_key").on(row.actorId, row.requestId),
    foreignKey({
      name: "asset_booking_automation_receipt_run_fk",
      columns: [row.siteId, row.runId],
      foreignColumns: [assetBookingAutomationRuns.siteId, assetBookingAutomationRuns.id],
    }),
    check(
      "asset_booking_automation_receipt_check",
      sql`${row.fingerprint} ~ '^[0-9a-f]{64}$' AND (
      (${row.kind} = 'save_profile' AND ${row.runId} IS NULL) OR (${row.kind} = 'retry' AND ${row.runId} IS NOT NULL)
    )`,
    ),
  ],
);

export type BookingAutomationRunRow = typeof assetBookingAutomationRuns.$inferSelect;
export type BookingAutomationAttemptRow = typeof assetBookingAutomationAttempts.$inferSelect;
