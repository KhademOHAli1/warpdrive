import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, users } from "./identity";

const encryptedSecret = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// These grants are owned Calendar connections, separate from Gmail and sign-in credentials.
// Access tokens remain short-lived server values and are never persisted here.
export const calendarProviderAccounts = pgTable(
  "calendar_provider_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"google">().notNull().default("google"),
    providerSubject: text("provider_subject").notNull(),
    clientId: text("client_id").notNull(),
    emailAddress: citext("email_address").notNull(),
    refreshTokenEnc: encryptedSecret("refresh_token_enc"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: text("status")
      .$type<"connected" | "reauthRequired" | "disconnected">()
      .notNull()
      .default("connected"),
    version: integer("version").notNull().default(1),
    // Grant lifetime is stable across ordinary refresh-token rotation.
    connectionGeneration: integer("connection_generation").notNull().default(1),
    lastErrorCode: text("last_error_code"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("calendar_provider_owner_subject_uniq").on(t.userId, t.provider, t.providerSubject),
    unique("calendar_provider_id_owner_uniq").on(t.id, t.userId),
    index("calendar_provider_owner_status_idx").on(t.userId, t.status),
    check("calendar_provider_google", sql`${t.provider} = 'google'`),
    check(
      "calendar_provider_status",
      sql`${t.status} in ('connected','reauthRequired','disconnected')`,
    ),
    check("calendar_provider_scope_array", sql`jsonb_typeof(${t.scopes}) = 'array'`),
  ],
);

// The callback needs BOTH the signed-in owner and a separate browser cookie. Only
// hashes are persisted; consuming the row clears the encrypted single-use verifier.
export const calendarOAuthAttempts = pgTable(
  "calendar_oauth_attempts",
  {
    stateHash: text("state_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    browserBindingHash: text("browser_binding_hash").notNull(),
    codeVerifierEnc: encryptedSecret("code_verifier_enc"),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    requestedAccess: text("requested_access").$type<"readOnly" | "readWrite">().notNull(),
    accountId: uuid("account_id"),
    // Legacy credential snapshot, retained for later cleanup; new callbacks never use it.
    accountVersion: integer("account_version"),
    accountConnectionGeneration: integer("account_connection_generation"),
    // Null marks a legacy attempt; an empty object is a valid new-account snapshot.
    accountConnectionGenerations: jsonb("account_connection_generations").$type<
      Record<string, number>
    >(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("calendar_oauth_owner_expiry_idx").on(t.userId, t.expiresAt),
    foreignKey({
      columns: [t.accountId, t.userId],
      foreignColumns: [calendarProviderAccounts.id, calendarProviderAccounts.userId],
    }).onDelete("cascade"),
    check("calendar_oauth_access", sql`${t.requestedAccess} in ('readOnly','readWrite')`),
  ],
);
