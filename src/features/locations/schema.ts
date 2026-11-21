import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import type { LocationSiteRole } from "./contracts";

export const directorySites = pgTable(
  "directory_sites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    archived: boolean("archived").notNull().default(false),
  },
  (table) => [
    unique("directory_sites_code_key").on(table.code),
    check("directory_sites_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 100`),
    check("directory_sites_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'`),
  ],
);

export const directoryLocations = pgTable(
  "directory_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    code: text("code").notNull(),
    archived: boolean("archived").notNull().default(false),
  },
  (table) => [
    unique("directory_locations_site_id_key").on(table.siteId, table.id),
    unique("directory_locations_site_code_key").on(table.siteId, table.code),
    foreignKey({
      name: "directory_locations_parent_site_fk",
      columns: [table.siteId, table.parentId],
      foreignColumns: [table.siteId, table.id],
    }),
    index("directory_locations_site_parent_idx").on(table.siteId, table.parentId),
    check("directory_locations_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 100`),
    check("directory_locations_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'`),
    check("directory_locations_no_self_parent", sql`${table.parentId} <> ${table.id}`),
  ],
);

export const directorySiteGrants = pgTable(
  "directory_site_grants",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<LocationSiteRole>().notNull(),
  },
  (table) => [
    primaryKey({ name: "directory_site_grants_pkey", columns: [table.siteId, table.userId] }),
    index("directory_site_grants_user_idx").on(table.userId),
    check("directory_site_grants_role_check", sql`${table.role} IN ('viewer', 'manager')`),
  ],
);

export const directoryCommandReceipts = pgTable(
  "directory_command_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    locationId: uuid("location_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "directory_command_receipts_pkey",
      columns: [table.actorId, table.requestId],
    }),
    foreignKey({
      name: "directory_command_receipts_location_fk",
      columns: [table.siteId, table.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      "directory_command_receipts_fingerprint_check",
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
