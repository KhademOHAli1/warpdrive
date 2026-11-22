import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { assetKitDefinitions, assetKits } from "../kits/schema";
import { assetModels, assetRecords } from "../schema";
import type {
  Booking,
  BookingDemand,
  BookingEvent,
  BookingPolicy,
  BookingRole,
  PullListItem,
} from "./contracts";

export type BookingMembershipRole = Extract<BookingRole, "base" | "self_service">;
export type BookingFeedScope = "self" | "site";
export type AssetBookingEventSnapshot = Pick<
  Booking,
  "title" | "window" | "status" | "archived" | "lines"
>;

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const assetBookingPolicies = pgTable(
  "asset_booking_policies",
  {
    siteId: uuid("site_id")
      .primaryKey()
      .references(() => directorySites.id),
    version: integer("version").notNull(),
    policy: jsonb("policy").$type<BookingPolicy>().notNull(),
  },
  (row) => [
    check("asset_booking_policies_version_check", sql`${row.version} > 0`),
    check(
      "asset_booking_policies_shape_check",
      sql`CASE WHEN jsonb_typeof(${row.policy}) = 'object'
        AND jsonb_typeof(${row.policy}->'workingHours'->'weekly') = 'array'
        AND jsonb_typeof(${row.policy}->'workingHours'->'overrides') = 'array'
        THEN jsonb_array_length(${row.policy}->'workingHours'->'weekly') = 7
          AND jsonb_array_length(${row.policy}->'workingHours'->'overrides') <= 366
        ELSE false END`,
    ),
  ],
);

export const assetBookingMemberships = pgTable(
  "asset_booking_memberships",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<BookingMembershipRole>().notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.siteId, row.userId] }),
    index("asset_booking_memberships_user_idx").on(row.userId),
    check("asset_booking_memberships_role_check", sql`${row.role} IN ('base', 'self_service')`),
  ],
);

export const assetBookings = pgTable(
  "asset_bookings",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    requesterId: uuid("requester_id").references(() => users.id, { onDelete: "set null" }),
    requesterName: text("requester_name").notNull(),
    requesterRole: text("requester_role").$type<Booking["requesterRole"]>().notNull(),
    startAt: instant("start_at").notNull(),
    endAt: instant("end_at").notNull(),
    status: text("status").$type<Booking["status"]>().notNull(),
    archived: boolean("archived").notNull().default(false),
    updatedAt: instant("updated_at").notNull(),
  },
  (row) => [
    unique("asset_bookings_site_id_key").on(row.siteId, row.id),
    index("asset_bookings_site_updated_idx").on(row.siteId, row.updatedAt),
    index("asset_bookings_site_window_idx")
      .on(row.siteId, row.endAt, row.startAt)
      .where(sql`NOT ${row.archived} AND ${row.status} IN ('pending', 'confirmed')`),
    index("asset_bookings_requester_site_idx").on(row.requesterId, row.siteId),
    check("asset_bookings_window_check", sql`${row.startAt} < ${row.endAt}`),
    check("asset_bookings_version_check", sql`${row.version} > 0`),
    check(
      "asset_bookings_status_check",
      sql`${row.status} IN ('draft', 'pending', 'confirmed', 'cancelled')`,
    ),
    check(
      "asset_bookings_requester_role_check",
      sql`${row.requesterRole} IN ('base', 'self_service', 'manager')`,
    ),
    check(
      "asset_bookings_title_check",
      sql`length(btrim(${row.title})) BETWEEN 1 AND 120 AND length(btrim(${row.requesterName})) > 0`,
    ),
    check(
      "asset_bookings_description_check",
      sql`length(btrim(${row.description})) BETWEEN 1 AND 1500`,
    ),
  ],
);

function resourceColumns() {
  return {
    kind: text("kind").$type<BookingDemand["kind"]>().notNull(),
    assetId: uuid("asset_id"),
    modelId: uuid("model_id"),
    kitId: uuid("kit_id"),
    locationId: uuid("location_id"),
    quantity: integer("quantity").notNull(),
  };
}

type Resource = Record<"siteId" | keyof ReturnType<typeof resourceColumns>, AnyPgColumn>;

function resourceConstraints(
  prefix: "asset_booking_lines" | "asset_booking_maintenance",
  row: Resource,
) {
  return [
    foreignKey({
      name: `${prefix}_asset_fk`,
      columns: [row.siteId, row.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: `${prefix}_model_fk`,
      columns: [row.siteId, row.modelId],
      foreignColumns: [assetModels.siteId, assetModels.id],
    }),
    foreignKey({
      name: `${prefix}_kit_fk`,
      columns: [row.siteId, row.kitId],
      foreignColumns: [assetKits.siteId, assetKits.id],
    }),
    foreignKey({
      name: `${prefix}_location_fk`,
      columns: [row.siteId, row.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      `${prefix}_resource_check`,
      sql`(${row.kind} IN ('asset', 'returnable_pool', 'consumable_pool')
          AND ${row.assetId} IS NOT NULL AND ${row.modelId} IS NULL AND ${row.kitId} IS NULL)
        OR (${row.kind} = 'model'
          AND ${row.modelId} IS NOT NULL AND ${row.assetId} IS NULL AND ${row.kitId} IS NULL)
        OR (${row.kind} = 'kit'
          AND ${row.kitId} IS NOT NULL AND ${row.assetId} IS NULL AND ${row.modelId} IS NULL)`,
    ),
    check(
      `${prefix}_quantity_check`,
      sql`${row.quantity} BETWEEN 1 AND 1000000
        AND (${row.kind} NOT IN ('asset', 'kit') OR ${row.quantity} = 1)
        AND (${row.kind} NOT IN ('returnable_pool', 'consumable_pool') OR ${row.locationId} IS NOT NULL)`,
    ),
  ];
}

export const assetBookingLines = pgTable(
  "asset_booking_lines",
  {
    bookingId: uuid("booking_id").notNull(),
    position: integer("position").notNull(),
    siteId: uuid("site_id").notNull(),
    ...resourceColumns(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    bin: text("bin"),
    serial: text("serial"),
    contents: jsonb("contents").$type<PullListItem[]>().notNull().default(sql`'[]'::jsonb`),
    kitDefinitionVersion: integer("kit_definition_version"),
  },
  (row) => [
    primaryKey({ columns: [row.bookingId, row.position] }),
    foreignKey({
      name: "asset_booking_lines_booking_fk",
      columns: [row.siteId, row.bookingId],
      foreignColumns: [assetBookings.siteId, assetBookings.id],
    }),
    ...resourceConstraints("asset_booking_lines", row),
    foreignKey({
      name: "asset_booking_lines_kit_definition_fk",
      columns: [row.siteId, row.kitId, row.kitDefinitionVersion],
      foreignColumns: [
        assetKitDefinitions.siteId,
        assetKitDefinitions.kitId,
        assetKitDefinitions.definitionVersion,
      ],
    }),
    index("asset_booking_lines_site_kit_idx")
      .on(row.siteId, row.kitId)
      .where(sql`${row.kitId} IS NOT NULL`),
    index("asset_booking_lines_site_location_idx")
      .on(row.siteId, row.locationId)
      .where(sql`${row.locationId} IS NOT NULL`),
    check("asset_booking_lines_position_check", sql`${row.position} BETWEEN 0 AND 59`),
    check(
      "asset_booking_lines_kit_definition_check",
      sql`(${row.kind} = 'kit') = (${row.kitDefinitionVersion} IS NOT NULL)
        AND (${row.kitDefinitionVersion} IS NULL OR ${row.kitDefinitionVersion} > 0)`,
    ),
    check(
      "asset_booking_lines_snapshot_check",
      sql`length(btrim(${row.name})) BETWEEN 1 AND 120
        AND length(btrim(${row.code})) BETWEEN 1 AND 80
        AND (${row.bin} IS NULL OR length(btrim(${row.bin})) > 0)
        AND (${row.serial} IS NULL OR (${row.kind} = 'asset' AND length(btrim(${row.serial})) BETWEEN 1 AND 80))`,
    ),
    check(
      "asset_booking_lines_contents_check",
      sql`CASE WHEN jsonb_typeof(${row.contents}) = 'array' THEN jsonb_array_length(${row.contents}) <= 60
        AND (${row.kind} = 'kit' OR jsonb_array_length(${row.contents}) = 0) ELSE false END`,
    ),
  ],
);

export const assetBookingEvents = pgTable(
  "asset_booking_events",
  {
    bookingId: uuid("booking_id").notNull(),
    version: integer("version").notNull(),
    siteId: uuid("site_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    at: instant("at").notNull(),
    kind: text("kind").$type<BookingEvent["kind"]>().notNull(),
    reason: text("reason"),
    snapshot: jsonb("snapshot").$type<AssetBookingEventSnapshot>().notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.bookingId, row.version] }),
    foreignKey({
      name: "asset_booking_events_booking_fk",
      columns: [row.siteId, row.bookingId],
      foreignColumns: [assetBookings.siteId, assetBookings.id],
    }),
    check("asset_booking_events_version_check", sql`${row.version} > 0`),
    check(
      "asset_booking_events_kind_check",
      sql`${row.kind} IN ('created', 'edited', 'duplicated', 'submitted', 'approved', 'sent_back',
        'declined', 'cancelled', 'archived', 'restored', 'approval_disabled')`,
    ),
    check("asset_booking_events_reason_check", sql`length(btrim(${row.reason})) BETWEEN 1 AND 500`),
    check(
      "asset_booking_events_snapshot_check",
      sql`CASE WHEN jsonb_typeof(${row.snapshot}) = 'object'
        AND jsonb_typeof(${row.snapshot}->'title') = 'string'
        AND jsonb_typeof(${row.snapshot}->'status') = 'string'
        AND jsonb_typeof(${row.snapshot}->'archived') = 'boolean'
        AND jsonb_typeof(${row.snapshot}->'window'->'startAt') = 'string'
        AND jsonb_typeof(${row.snapshot}->'window'->'endAt') = 'string'
        AND jsonb_typeof(${row.snapshot}->'lines') = 'array'
        THEN jsonb_array_length(${row.snapshot}->'lines') <= 60 ELSE false END`,
    ),
  ],
);

export const assetBookingMaintenance = pgTable(
  "asset_booking_maintenance",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    startAt: instant("start_at").notNull(),
    endAt: instant("end_at").notNull(),
    cancelled: boolean("cancelled").notNull().default(false),
    ...resourceColumns(),
  },
  (row) => [
    ...resourceConstraints("asset_booking_maintenance", row),
    index("asset_booking_maintenance_window_idx")
      .on(row.siteId, row.endAt, row.startAt)
      .where(sql`NOT ${row.cancelled}`),
    check(
      "asset_booking_maintenance_title_check",
      sql`length(btrim(${row.title})) BETWEEN 1 AND 120`,
    ),
    check("asset_booking_maintenance_window_check", sql`${row.startAt} < ${row.endAt}`),
    check("asset_booking_maintenance_version_check", sql`${row.version} > 0`),
  ],
);

export const assetBookingReceipts = pgTable(
  "asset_booking_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    bookingId: uuid("booking_id"),
    fingerprint: text("fingerprint").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.actorId, row.requestId] }),
    foreignKey({
      name: "asset_booking_receipts_booking_fk",
      columns: [row.siteId, row.bookingId],
      foreignColumns: [assetBookings.siteId, assetBookings.id],
    }),
    check("asset_booking_receipts_fingerprint_check", sql`${row.fingerprint} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const assetBookingFeeds = pgTable(
  "asset_booking_feeds",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").$type<BookingFeedScope>().notNull(),
    secretDigest: text("secret_digest").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    revokedAt: instant("revoked_at"),
  },
  (row) => [
    unique("asset_booking_feeds_digest_key").on(row.secretDigest),
    index("asset_booking_feeds_actor_site_idx").on(row.actorId, row.siteId),
    check("asset_booking_feeds_scope_check", sql`${row.scope} IN ('self', 'site')`),
    check("asset_booking_feeds_digest_check", sql`${row.secretDigest} ~ '^[a-f0-9]{64}$'`),
    check("asset_booking_feeds_revoked_check", sql`${row.revokedAt} >= ${row.createdAt}`),
  ],
);
