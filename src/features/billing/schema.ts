import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SubscriptionSnapshot } from "./contracts";

// Installation-scoped, matching the current single-workspace application. Not a tenancy boundary.
// Integration must admit the companion migration before enabling the billing feature.
export const billingAccounts = pgTable(
  "billing_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull().default("workspace"),
    livemode: boolean("livemode").notNull(),
    customerId: text("customer_id").unique(),
    checkoutOperationId: uuid("checkout_operation_id"),
    seatOperationId: uuid("seat_operation_id"),
    subscription: jsonb("subscription").$type<SubscriptionSnapshot | null>(),
    syncState: text("sync_state").notNull().default("never"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("billing_accounts_scope_mode_uq").on(t.scope, t.livemode),
    check("billing_accounts_scope_check", sql`${t.scope} = 'workspace'`),
    check(
      "billing_accounts_sync_check",
      sql`${t.syncState} IN ('never', 'current', 'needs_review')`,
    ),
  ],
);

export const billingOperations = pgTable(
  "billing_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => billingAccounts.id),
    kind: text("kind").notNull(),
    requestKey: text("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    resourceId: text("resource_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("billing_operations_request_uq").on(t.accountId, t.kind, t.requestKey),
    check("billing_operations_kind_check", sql`${t.kind} IN ('customer', 'checkout', 'seats')`),
  ],
);

export const billingWebhookReceipts = pgTable(
  "billing_webhook_receipts",
  {
    eventId: text("event_id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => billingAccounts.id),
    type: text("type").notNull(),
    digest: text("digest").notNull(),
    providerCreated: integer("provider_created").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("billing_webhook_account_idx").on(t.accountId)],
);

// Minimal operational evidence: never raw webhook bodies, card data or signed portal/download URLs.
export const billingAuditEvents = pgTable(
  "billing_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => billingAccounts.id),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("billing_audit_account_idx").on(t.accountId)],
);
