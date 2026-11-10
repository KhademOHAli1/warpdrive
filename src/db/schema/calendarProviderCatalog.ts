import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { GoogleCalendarEntry } from "@/features/activities/providers/google/schemas";
import { calendarProviderAccounts } from "./calendarProviderAccounts";
import { calendars } from "./calendars";

export const calendarProviderCatalogStates = pgTable(
  "calendar_provider_catalog_states",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => calendarProviderAccounts.id, { onDelete: "cascade" }),
    latestRunId: uuid("latest_run_id").notNull(),
    requestedGeneration: integer("requested_generation").notNull(),
    requestExpiresAt: timestamp("request_expires_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"refreshing" | "ready" | "error">().notNull(),
    publishedRunId: uuid("published_run_id"),
    publishedGeneration: integer("published_generation"),
    revision: integer("revision").notNull().default(0),
    syncToken: text("sync_token"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
  },
  (t) => [
    check("calendar_catalog_request_generation", sql`${t.requestedGeneration} > 0`),
    check("calendar_catalog_status", sql`${t.status} in ('refreshing','ready','error')`),
    check(
      "calendar_catalog_publication",
      sql`(
      ${t.revision} = 0 and ${t.publishedRunId} is null and ${t.publishedGeneration} is null
      and ${t.syncToken} is null and ${t.discoveredAt} is null
    ) or (
      ${t.revision} > 0 and ${t.publishedRunId} is not null
      and ${t.publishedGeneration} is not null and ${t.publishedGeneration} > 0
      and ${t.syncToken} is not null and ${t.discoveredAt} is not null
    )`,
    ),
  ],
);

export const calendarProviderCalendars = pgTable(
  "calendar_provider_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    userId: uuid("user_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    // Raw identifiers may exceed a B-tree key. The publisher also compares exact
    // identifiers on a hash conflict and requires a row returned for every input.
    calendarIdHash: text("calendar_id_hash")
      .notNull()
      .generatedAlwaysAs(sql`encode(digest("calendar_id", 'sha256'), 'hex')`),
    raw: jsonb("raw").$type<GoogleCalendarEntry>().notNull(),
    connectionGeneration: integer("connection_generation").notNull(),
    lastSeenRevision: integer("last_seen_revision").notNull(),
  },
  (t) => [
    unique("calendar_provider_calendar_identity_uniq").on(t.accountId, t.calendarIdHash),
    unique("calendar_provider_calendar_owner_uniq").on(t.id, t.userId),
    foreignKey({
      columns: [t.accountId, t.userId],
      foreignColumns: [calendarProviderAccounts.id, calendarProviderAccounts.userId],
    }).onDelete("cascade"),
    check("calendar_provider_calendar_raw_object", sql`jsonb_typeof(${t.raw}) = 'object'`),
    check("calendar_provider_calendar_generation", sql`${t.connectionGeneration} > 0`),
    check("calendar_provider_calendar_revision", sql`${t.lastSeenRevision} > 0`),
  ],
);

export const calendarProviderBindings = pgTable(
  "calendar_provider_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    providerCalendarId: uuid("provider_calendar_id").notNull(),
    localCalendarId: uuid("local_calendar_id").notNull(),
    calendarSource: text("calendar_source").$type<"provider">().notNull().default("provider"),
    selected: boolean("selected").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("calendar_provider_binding_source_uniq").on(t.providerCalendarId),
    unique("calendar_provider_binding_local_uniq").on(t.localCalendarId),
    foreignKey({
      columns: [t.providerCalendarId, t.userId],
      foreignColumns: [calendarProviderCalendars.id, calendarProviderCalendars.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.localCalendarId, t.userId, t.calendarSource],
      foreignColumns: [calendars.id, calendars.ownerId, calendars.source],
    }),
    check("calendar_provider_binding_source", sql`${t.calendarSource} = 'provider'`),
    check("calendar_provider_binding_version", sql`${t.version} > 0`),
  ],
);
