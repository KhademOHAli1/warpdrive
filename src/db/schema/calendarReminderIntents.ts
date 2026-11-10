import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { activities } from "./activities";
import { activityReminderSettings } from "./calendarReminderSettings";
import { users } from "./identity";
import { notifications } from "./notifications";

// Queue outages cannot invalidate an event save. This row is committed with the event,
// and its UUID also identifies the queue job across an interrupted dispatch.
export const calendarReminderIntents = pgTable(
  "calendar_reminder_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id")
      .notNull()
      .references(() => users.id),
    settingsId: uuid("settings_id").references(() => activityReminderSettings.id, {
      onDelete: "cascade",
    }),
    settingsVersion: integer("settings_version").notNull().default(0),
    defaultsVersion: integer("defaults_version").notNull().default(0),
    eventSignature: text("event_signature").notNull().default(""),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
    state: text("state")
      .$type<"pending" | "dispatched" | "delivered" | "cancelled">()
      .notNull()
      .default("pending"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    notificationId: uuid("notification_id").references(() => notifications.id, {
      onDelete: "set null",
    }),
    emailEnqueuedAt: timestamp("email_enqueued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_reminder_dispatch_idx").on(t.state, t.fireAt),
    index("activity_reminder_activity_idx").on(t.activityId),
    index("activity_reminder_notification_idx").on(t.notificationId),
  ],
);
