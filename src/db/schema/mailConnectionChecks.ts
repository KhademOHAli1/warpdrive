import { customType, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sessions, users } from "./identity";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// Short-lived credential material is encrypted, session-bound and erased on consumption.
export const mailConnectionChecks = pgTable(
  "mail_connection_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    payloadEnc: bytea("payload_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mail_connection_checks_expiry_idx").on(t.expiresAt)],
);
