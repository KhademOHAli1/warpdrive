import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const fingerprint = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export type NewsletterReceiptState = "admitted" | "succeeded" | "failed" | "unknown";

export type NewsletterResolutionOutcome = "applied" | "notApplied";
export type NewsletterEvidenceSource =
  | "engineRecord"
  | "engineLog"
  | "deliveryLog"
  | "importStatus";

export type NewsletterReceiptResult =
  | { acknowledged: true }
  | { id: number }
  | { reloadDeferred: boolean; unchanged: boolean }
  | { deleted: number | null };

export const newsletterOperationReceipts = pgTable(
  "newsletter_operation_receipts",
  {
    // Keep historical actor linkage without introducing a new account-deletion constraint.
    actorId: uuid("actor_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    operation: text("operation").notNull(),
    intentVersion: smallint("intent_version").notNull().default(1),
    intentFingerprint: fingerprint("intent_fingerprint").notNull(),
    state: text("state").$type<NewsletterReceiptState>().notNull().default("admitted"),
    result: jsonb("result").$type<NewsletterReceiptResult>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolutionOutcome: text("resolution_outcome").$type<NewsletterResolutionOutcome>(),
    evidenceSource: text("evidence_source").$type<NewsletterEvidenceSource>(),
    evidenceReference: text("evidence_reference"),
  },
  (table) => [
    primaryKey({
      name: "newsletter_operation_receipts_pkey",
      columns: [table.actorId, table.operationId],
    }),
    check(
      "newsletter_receipt_operation_ck",
      sql`${table.operation} ~ '^[a-z][a-zA-Z]*[.][a-z][a-zA-Z]*$' AND char_length(${table.operation}) <= 80`,
    ),
    check("newsletter_receipt_intent_version_ck", sql`${table.intentVersion} = 1`),
    check("newsletter_receipt_fingerprint_ck", sql`octet_length(${table.intentFingerprint}) = 32`),
    check(
      "newsletter_receipt_state_ck",
      sql`
      (${table.state} = 'admitted' AND ${table.finishedAt} IS NULL AND ${table.result} IS NULL)
      OR (${table.state} IN ('failed', 'unknown') AND ${table.finishedAt} IS NOT NULL AND ${table.result} IS NULL)
      OR (${table.state} = 'succeeded' AND ${table.finishedAt} IS NOT NULL AND ${table.result} IS NOT NULL
        AND jsonb_typeof(${table.result}) = 'object' AND octet_length(${table.result}::text) <= 128)
    `,
    ),
    check(
      "newsletter_receipt_resolution_ck",
      sql`
      (${table.reviewedAt} IS NULL AND ${table.resolutionOutcome} IS NULL
        AND ${table.evidenceSource} IS NULL AND ${table.evidenceReference} IS NULL)
      OR (${table.state} IN ('admitted', 'unknown') AND ${table.reviewedAt} IS NOT NULL
        AND ${table.resolutionOutcome} IS NOT NULL AND ${table.resolutionOutcome} IN ('applied', 'notApplied')
        AND ${table.evidenceSource} IS NOT NULL AND ${table.evidenceSource} IN ('engineRecord', 'engineLog', 'deliveryLog', 'importStatus')
        AND ${table.evidenceReference} IS NOT NULL AND ${table.evidenceReference} ~
          '^([1-9][0-9]{0,15}|[A-Z]{2,12}-[0-9]{1,16}|[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$')
    `,
    ),
    index("newsletter_receipts_state_created_idx").on(table.state, table.createdAt),
  ],
);
