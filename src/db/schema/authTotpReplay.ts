import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authTwoFactors } from "./authentication";

export const authTotpReplays = pgTable(
  "auth_totp_replays",
  {
    factorId: uuid("factor_id")
      .notNull()
      .references(() => authTwoFactors.id, { onDelete: "cascade" }),
    digest: text("digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.factorId, table.digest] }),
    index("auth_totp_replay_expiry_idx").on(table.expiresAt),
  ],
);
