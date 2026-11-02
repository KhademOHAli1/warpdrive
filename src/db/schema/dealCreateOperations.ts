import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "./deals";
import { users } from "./identity";

const fingerprint = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// Completed receipts only. No raw intent, session reference or credential is retained.
// Actor erasure is deliberately restricted until its separate lifecycle is admitted.
export const dealCreateOperations = pgTable(
  "deal_create_operations",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull(),
    intentVersion: smallint("intent_version").notNull(),
    intentFingerprint: fingerprint("intent_fingerprint").notNull(),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({
      name: "deal_create_operations_pkey",
      columns: [table.actorId, table.operationId],
    }),
    check("deal_create_operation_version_ck", sql`${table.intentVersion} = 1`),
    check(
      "deal_create_operation_fingerprint_ck",
      sql`octet_length(${table.intentFingerprint}) = 32`,
    ),
    index("deal_create_operations_deal_idx")
      .on(table.dealId)
      .where(sql`${table.dealId} is not null`),
  ],
);
