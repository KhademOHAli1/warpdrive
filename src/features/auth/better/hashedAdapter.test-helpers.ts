import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { BetterAuthOptions } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { TestDb } from "@/test/db";

export const qualificationUsers = pgTable("auth_qualification_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(true),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const qualificationSessions = pgTable("auth_qualification_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => qualificationUsers.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const qualificationOptions: BetterAuthOptions = {
  advanced: { database: { generateId: () => randomUUID() } },
  session: { fields: { token: "tokenHash" } },
};

export async function prepareQualificationDb(h: TestDb) {
  await h.pool.query(`CREATE TABLE auth_qualification_users (
    id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL,
    email_verified boolean NOT NULL DEFAULT true, image text,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  ); CREATE TABLE auth_qualification_sessions (
    id text PRIMARY KEY, user_id text NOT NULL REFERENCES auth_qualification_users(id),
    token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    ip_address text, user_agent text, revoked_at timestamptz
  )`);
  const db = drizzle(h.pool, {
    schema: { user: qualificationUsers, session: qualificationSessions },
  });
  const userId = randomUUID();
  await db.insert(qualificationUsers).values({
    id: userId,
    name: "Qualification user",
    email: "qualification@example.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const factory = drizzleAdapter(db, {
    provider: "pg",
    schema: { user: qualificationUsers, session: qualificationSessions },
    transaction: true,
  });
  return { db, factory, userId };
}

export function sessionData(userId: string, token: string) {
  return {
    id: randomUUID(),
    userId,
    token,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ipAddress: "127.0.0.1",
    userAgent: "Qualification",
  };
}

export type QualificationSession = ReturnType<typeof sessionData>;
