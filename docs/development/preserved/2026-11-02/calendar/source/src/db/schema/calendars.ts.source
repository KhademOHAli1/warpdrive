import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const calendars = pgTable(
  "calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    timeZone: text("time_zone").notNull(),
    source: text("source").$type<"native" | "provider">().notNull().default("native"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("calendar_primary_owner").on(t.ownerId).where(sql`${t.isPrimary} = true`),
    unique("calendar_id_owner_source_uniq").on(t.id, t.ownerId, t.source),
    check("calendar_source", sql`${t.source} in ('native','provider')`),
    check(
      "calendar_provider_not_primary",
      sql`${t.source} <> 'provider' or ${t.isPrimary} = false`,
    ),
  ],
);

export const calendarMembers = pgTable(
  "calendar_members",
  {
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"freeBusy" | "reader" | "editor">().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.calendarId, t.userId] }),
    check("calendar_member_role", sql`${t.role} in ('freeBusy','reader','editor')`),
  ],
);
