import {
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

const encrypted = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    accountId: text("account_id").notNull(),
    accountName: text("account_name").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    credentials: encrypted("credentials"),
    status: text("status").notNull().default("connected"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    settings: jsonb("settings").$type<{ channelId?: string }>().notNull().default({}),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_connections_provider_account_uq").on(table.provider, table.accountId),
  ],
);

export const integrationOAuthAttempts = pgTable(
  "integration_oauth_attempts",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: uuid("session_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [index("integration_oauth_attempts_expiry_idx").on(table.expiresAt)],
);

export const integrationEvents = pgTable(
  "integration_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("integration_events_connection_idx").on(table.connectionId, table.createdAt)],
);
