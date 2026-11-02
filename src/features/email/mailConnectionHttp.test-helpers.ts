import { randomBytes } from "node:crypto";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { authUsers, sessions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { mintCsrfToken } from "@/features/auth/csrf";

export interface MailSessionFixtureOptions {
  email?: string;
  googleSub?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  assurance?: "pending" | "password" | "mfa" | "passkey";
  freshAt?: Date | null;
  mfaAt?: Date | null;
  lastSeenAt?: Date;
  createdAt?: Date;
  expiresAt?: Date;
}

export async function seedMailHttpSession(db: Db, options: MailSessionFixtureOptions = {}) {
  const user = await seedUser(db, {
    ...(options.email === undefined ? {} : { email: options.email }),
    ...(options.googleSub === undefined ? {} : { googleSub: options.googleSub }),
    isAdmin: options.isAdmin ?? false,
    isActive: options.isActive ?? true,
  });
  await db.insert(authUsers).values({
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: options.emailVerified ?? true,
    twoFactorEnabled: options.twoFactorEnabled ?? false,
  });
  const raw = randomBytes(32).toString("base64url");
  const now = new Date();
  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: hashSessionCredential(raw),
      authMethod: "password",
      assurance: options.assurance ?? "password",
      freshAuthenticatedAt: options.freshAt === undefined ? now : options.freshAt,
      mfaVerifiedAt: options.mfaAt ?? null,
      lastSeenAt: options.lastSeenAt ?? now,
      createdAt: options.createdAt ?? now,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 3_600_000),
    })
    .returning({ id: sessions.id });
  if (session === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing synthetic session", {});
  const csrf = mintCsrfToken();
  const origin = new URL(env.BASE_URL).origin;
  const headers = new Headers({
    cookie: `wd_sid=${raw}.synthetic-envelope; wd_csrf=${csrf}`,
    origin,
    host: new URL(origin).host,
    "content-type": "application/json",
    "x-csrf-token": csrf,
    "sec-fetch-site": "same-origin",
  });
  return { user, context: { actorId: user.id, sessionId: session.id }, headers, origin };
}

export const syntheticCheckedMailbox = {
  input: {
    emailAddress: "owner@example.test",
    imap: {
      host: "imap.example.test",
      port: 993,
      security: "tls" as const,
      username: "owner",
      password: "synthetic-check-secret",
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      security: "tls" as const,
      username: "owner",
      password: "synthetic-send-secret",
    },
  },
  identityKey: "http-synthetic-mailbox",
  folders: [{ path: "INBOX", name: "Inbox", role: "inbox" as const, readOnly: false }],
  capabilities: { read: true, send: true, markRead: true, move: true, trash: false },
};
