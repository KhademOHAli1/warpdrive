import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { activities } from "./activities";
import { notifications } from "./notifications";

// One current native Calendar intent/temporal-metadata row per activity. Legacy
// activities have no fabricated metadata or reminder adoption from a migration.
// Completed notification deletion keeps the delivered state as its tombstone.
export const activityReminderIntents = pgTable(
  "activity_reminder_intents",
  {
    activityId: uuid("activity_id")
      .primaryKey()
      .references(() => activities.id, { onDelete: "cascade" }),
    version: smallint("version").notNull().default(1),
    generationId: uuid("generation_id").notNull().defaultRandom(),
    // Temporal metadata alone must not take over an unselected legacy reminder.
    managed: boolean("managed").notNull().default(false),
    channel: text("channel").notNull().default("in_app"),
    // Event authorship and reminder authorship are different for legacy events.
    eventTimeZone: text("event_time_zone"),
    reminderTimeZone: text("reminder_time_zone"),
    selection: jsonb("selection").notNull().default(sql`'{"kind":"none"}'::jsonb`),
    fireAt: timestamp("fire_at", { withTimezone: true }),
    status: text("status").notNull().default("cancelled"),
    attemptCount: integer("attempt_count").notNull().default(0),
    // Distinguishes an older failed callback from a later explicit retry/outcome.
    attemptVersion: uuid("attempt_version").notNull().defaultRandom(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorId: text("last_error_id"),
    outcomeReason: text("outcome_reason"),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    notificationId: uuid("notification_id").references(() => notifications.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("activity_reminder_intents_generation_key").on(t.generationId),
    check("activity_reminder_intents_version_ck", sql`${t.version} = 1`),
    check("activity_reminder_intents_channel_ck", sql`${t.channel} = 'in_app'`),
    check(
      "activity_reminder_intents_status_ck",
      sql`${t.status} IN ('pending', 'failed', 'delivered', 'suppressed', 'cancelled')`,
    ),
    check("activity_reminder_intents_attempt_count_ck", sql`${t.attemptCount} >= 0`),
    check("activity_reminder_intents_selection_ck", sql`jsonb_typeof(${t.selection}) = 'object'`),
    check(
      "activity_reminder_intents_reason_ck",
      sql`${t.outcomeReason} IS NULL OR ${t.outcomeReason} IN ('disabled', 'event_cancelled', 'event_finished', 'not_available', 'invalid_schedule', 'unsupported_parent')`,
    ),
    check(
      "activity_reminder_intents_managed_ck",
      sql`${t.managed} OR (${t.status} = 'cancelled' AND ${t.fireAt} IS NULL)`,
    ),
    check(
      "activity_reminder_intents_fire_ck",
      sql`${t.status} NOT IN ('pending', 'failed', 'delivered') OR (${t.fireAt} IS NOT NULL AND ${t.reminderTimeZone} IS NOT NULL)`,
    ),
    index("activity_reminder_intents_due_idx")
      .on(t.fireAt, t.nextAttemptAt)
      .where(sql`${t.managed} AND ${t.status} IN ('pending', 'failed')`),
  ],
);

export type ActivityReminderIntent = typeof activityReminderIntents.$inferSelect;
