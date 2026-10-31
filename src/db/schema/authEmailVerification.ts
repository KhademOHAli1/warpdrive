import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "./authentication";
import { citext } from "./identity";

// The native JWT remains the bearer proof. This ledger binds it to one immutable identity
// and serializes redemption; only a SHA-256 digest is stored outside encrypted mail.
export const authEmailVerificationTokens = pgTable(
  "auth_email_verification_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    targetEmail: citext("target_email"),
    purpose: text("purpose")
      .$type<"verification" | "change_confirmation" | "change_verification">()
      .notNull(),
    parentTokenHash: text("parent_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_email_verification_user_idx").on(table.userId, table.purpose),
    index("auth_email_verification_expiry_idx").on(table.expiresAt),
  ],
);
