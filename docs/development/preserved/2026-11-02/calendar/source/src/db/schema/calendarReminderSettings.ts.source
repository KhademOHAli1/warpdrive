import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DEFAULT_REMINDER_RULES,
  type ReminderDefaults,
} from "@/features/activities/reminderPolicy";
import type { RuleActivations } from "@/features/activities/reminderRuleActivation";
import { activities } from "./activities";
import { calendars } from "./calendars";
import { users } from "./identity";

export const calendarReminderDefaults = pgTable(
  "calendar_reminder_defaults",
  {
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rules: jsonb("rules").$type<ReminderDefaults>().notNull().default(DEFAULT_REMINDER_RULES),
    ruleActivations: jsonb("rule_activations").$type<RuleActivations>().notNull().default({}),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.calendarId, t.userId] })],
);

export const activityReminderSettings = pgTable(
  "activity_reminder_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").$type<"assignment" | "personal">().notNull().default("assignment"),
    useDefault: boolean("use_default").notNull().default(true),
    rules: jsonb("rules").$type<ReminderDefaults>().notNull().default(DEFAULT_REMINDER_RULES),
    version: integer("version").notNull().default(1),
    // An authored event zone wins; this pins the fallback for older activities with no zone.
    timeZone: text("time_zone").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("activity_reminder_settings_user_idx").on(t.activityId, t.userId),
    check("activity_reminder_source", sql`${t.source} in ('assignment','personal')`),
  ],
);

// The database also enqueues direct CRM/import/administration writers. Consumers acquire
// the activity lock before this row so a trigger cannot deadlock against reconciliation.
export const reminderRebuilds = pgTable("reminder_rebuilds", {
  activityId: uuid("activity_id")
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  touchedAt: timestamp("touched_at", { withTimezone: true }).notNull().defaultNow(),
});
