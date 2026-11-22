import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directorySites } from "@/features/locations/schema";
import type { AssetRegisterBatchOutcome } from "./contracts";

export type AssetRegisterDiscoveryReceiptKind = "batch" | "save_view" | "remove_view";

export const assetRegisterDiscoveryReceipts = pgTable(
  "asset_register_discovery_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    kind: text("kind").$type<AssetRegisterDiscoveryReceiptKind>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    outcomes: jsonb("outcomes").$type<AssetRegisterBatchOutcome[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (row) => [
    primaryKey({
      name: "asset_register_discovery_receipts_pkey",
      columns: [row.actorId, row.requestId],
    }),
    check(
      "asset_register_discovery_receipts_kind_check",
      sql`${row.kind} IN ('batch', 'save_view', 'remove_view')`,
    ),
    check(
      "asset_register_discovery_receipts_fingerprint_check",
      sql`${row.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "asset_register_discovery_receipts_outcomes_check",
      sql`CASE WHEN ${row.kind} = 'batch'
        THEN (CASE WHEN jsonb_typeof(${row.outcomes}) = 'array'
          THEN jsonb_array_length(${row.outcomes}) BETWEEN 1 AND 100 ELSE false END)
        ELSE ${row.outcomes} IS NULL END`,
    ),
  ],
);

export type AssetRegisterDiscoveryReceipt = typeof assetRegisterDiscoveryReceipts.$inferSelect;
