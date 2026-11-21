import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directorySites } from "@/features/locations/schema";
import type { OperationsRole } from "./contracts";

function knownRole(role: AnyPgColumn) {
  return sql`${role} IN ('warehouse_viewer', 'warehouse_manager', 'asset_viewer', 'asset_manager', 'buyer', 'cost_viewer')`;
}

export const operationsSiteGrants = pgTable(
  "operations_site_grants",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => directorySites.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<OperationsRole>().notNull(),
  },
  (table) => [
    primaryKey({
      name: "operations_site_grants_pkey",
      columns: [table.siteId, table.userId, table.role],
    }),
    index("operations_site_grants_user_idx").on(table.userId),
    check("operations_site_grants_role_check", knownRole(table.role)),
  ],
);

export const operationsAccessReceipts = pgTable(
  "operations_access_receipts",
  {
    actorId: uuid("actor_id").notNull(),
    requestId: uuid("request_id").notNull(),
    siteId: uuid("site_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<OperationsRole>().notNull(),
    enabled: boolean("enabled").notNull(),
    changed: boolean("changed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "operations_access_receipts_pkey",
      columns: [table.actorId, table.requestId],
    }),
    index("operations_access_receipts_subject_idx").on(table.userId, table.createdAt),
    check("operations_access_receipts_role_check", knownRole(table.role)),
  ],
);
