import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { releaseBomMaxBytes } from "../bomCsv";
import { releaseFixtureMaxFileBytes } from "../contracts";
import { inventoryProductReleases } from "../schema";
import type {
  ExportIntakeIssue,
  ExportIntakeKind,
  ExportIntakeState,
  ExportManifest,
} from "./contracts";

export const inventoryExportJobs = pgTable(
  "inventory_release_export_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    sku: text("sku").notNull(),
    revision: text("revision").notNull(),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    manifest: jsonb("manifest").$type<ExportManifest>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    draftFingerprint: text("draft_fingerprint").notNull(),
    state: text("state").$type<ExportIntakeState | "staging">().notNull().default("staging"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    stagingExpiresAt: timestamp("staging_expires_at", { withTimezone: true }).notNull(),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    retryUntil: timestamp("retry_until", { withTimezone: true }),
    activeAttemptId: uuid("active_attempt_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    failedAttemptId: uuid("failed_attempt_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    stagingPurgeAfter: timestamp("staging_purge_after", { withTimezone: true }),
    stagingPurgedAt: timestamp("staging_purged_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "inventory_release_export_jobs_release_fk",
      columns: [t.releaseId, t.itemId],
      foreignColumns: [inventoryProductReleases.id, inventoryProductReleases.itemId],
    }),
    uniqueIndex("inventory_release_export_jobs_live_fingerprint_key")
      .on(t.releaseId, t.fingerprint)
      .where(sql`${t.state} <> 'cancelled'`),
    index("inventory_release_export_jobs_history_idx").on(t.releaseId, t.submittedAt.desc(), t.id),
    index("inventory_release_export_jobs_queue_idx")
      .on(t.queuedAt, t.id)
      .where(sql`${t.state} = 'queued'`),
    index("inventory_release_export_jobs_lease_idx")
      .on(t.leaseUntil, t.id)
      .where(sql`${t.state} = 'working'`),
    index("inventory_release_export_jobs_staging_idx")
      .on(t.stagingExpiresAt, t.id)
      .where(sql`${t.state} = 'staging'`),
    index("inventory_release_export_jobs_retry_idx")
      .on(t.retryUntil, t.id)
      .where(sql`${t.state} = 'failed' AND ${t.failedAttemptId} IS NOT NULL`),
    index("inventory_release_export_jobs_purge_idx")
      .on(t.stagingPurgeAfter, t.id)
      .where(sql`${t.stagingPurgeAfter} IS NOT NULL AND ${t.stagingPurgedAt} IS NULL`),
    check(
      "inventory_release_export_jobs_header_check",
      sql`${t.sku} ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'
        AND ${t.revision} ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'
        AND ${t.fingerprint} ~ '^[0-9a-f]{64}$'
        AND ${t.draftFingerprint} ~ '^[0-9a-f]{64}$'
        AND ${t.stagingExpiresAt} > ${t.submittedAt}
        AND coalesce(${t.manifest}->>'schemaVersion' = '1', false)
        AND coalesce(${t.manifest}->'target'->>'sku' = ${t.sku}, false)
        AND coalesce(${t.manifest}->'target'->>'revision' = ${t.revision}, false)
        AND CASE WHEN jsonb_typeof(${t.manifest}->'files') = 'array'
          THEN jsonb_array_length(${t.manifest}->'files') BETWEEN 1 AND 16 ELSE false END`,
    ),
    check(
      "inventory_release_export_jobs_state_check",
      sql`(${t.queuedAt} IS NULL) = (${t.retryUntil} IS NULL)
        AND (${t.retryUntil} IS NULL OR ${t.retryUntil} > ${t.queuedAt})
        AND (${t.activeAttemptId} IS NOT NULL) = (${t.state} = 'working')
        AND (${t.leaseUntil} IS NOT NULL) = (${t.state} = 'working')
        AND (${t.publishedAt} IS NOT NULL) = (${t.state} = 'ready')
        AND (${t.failedAttemptId} IS NULL OR ${t.state} = 'failed')
        AND (${t.stagingPurgedAt} IS NULL OR ${t.stagingPurgedAt} >= ${t.stagingPurgeAfter})
        AND CASE ${t.state}
          WHEN 'staging' THEN ${t.queuedAt} IS NULL AND ${t.stagingPurgeAfter} IS NULL
          WHEN 'queued' THEN ${t.queuedAt} IS NOT NULL AND ${t.stagingPurgeAfter} IS NULL
          WHEN 'working' THEN ${t.queuedAt} IS NOT NULL AND ${t.stagingPurgeAfter} IS NULL
          WHEN 'ready' THEN ${t.queuedAt} IS NOT NULL AND ${t.stagingPurgeAfter} IS NOT NULL
          WHEN 'failed' THEN ${t.queuedAt} IS NOT NULL AND
            (${t.stagingPurgeAfter} IS NULL) = (${t.failedAttemptId} IS NOT NULL)
          WHEN 'cancelled' THEN ${t.stagingPurgeAfter} IS NOT NULL
          ELSE false END`,
    ),
  ],
);

export const inventoryExportFiles = pgTable(
  "inventory_release_export_files",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => inventoryExportJobs.id),
    ordinal: integer("ordinal").notNull(),
    artifactId: uuid("artifact_id").notNull().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").$type<ExportIntakeKind>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    contentType: text("content_type").notNull(),
  },
  (t) => [
    primaryKey({ name: "inventory_release_export_files_pk", columns: [t.jobId, t.ordinal] }),
    unique("inventory_release_export_files_artifact_key").on(t.artifactId),
    unique("inventory_release_export_files_name_key").on(t.jobId, t.name),
    uniqueIndex("inventory_release_export_files_bom_key")
      .on(t.jobId)
      .where(sql`${t.kind} = 'manufacturingBom'`),
    check(
      "inventory_release_export_files_header_check",
      sql`${t.ordinal} BETWEEN 0 AND 15 AND length(${t.name}) BETWEEN 1 AND 180
        AND ${t.kind} IN ('pcbFabrication','manufacturingBom','placement','enclosure','firmware','labelArtwork','testInstructions','pcbSource')
        AND ${t.sha256} ~ '^[0-9a-f]{64}$'
        AND ${t.contentType} IN ('application/zip','text/csv','text/plain','application/octet-stream','application/pdf','image/png')
        AND ${t.sizeBytes} BETWEEN 1 AND CASE WHEN ${t.kind} = 'manufacturingBom'
          THEN ${sql.raw(String(releaseBomMaxBytes))} ELSE ${sql.raw(String(releaseFixtureMaxFileBytes))} END`,
    ),
  ],
);

export const inventoryExportAttempts = pgTable(
  "inventory_release_export_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => inventoryExportJobs.id),
    ordinal: integer("ordinal").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome").$type<"ready" | "failed" | "cancelled">(),
    issue: jsonb("issue").$type<ExportIntakeIssue>(),
    sealPurgeAfter: timestamp("seal_purge_after", { withTimezone: true }),
    sealPurgedAt: timestamp("seal_purged_at", { withTimezone: true }),
  },
  (t) => [
    unique("inventory_release_export_attempts_job_ordinal_key").on(t.jobId, t.ordinal),
    uniqueIndex("inventory_release_export_attempts_open_key")
      .on(t.jobId)
      .where(sql`${t.outcome} IS NULL`),
    uniqueIndex("inventory_release_export_attempts_ready_key")
      .on(t.jobId)
      .where(sql`${t.outcome} = 'ready'`),
    index("inventory_release_export_attempts_purge_idx")
      .on(t.sealPurgeAfter, t.id)
      .where(sql`${t.sealPurgeAfter} IS NOT NULL AND ${t.sealPurgedAt} IS NULL`),
    check(
      "inventory_release_export_attempts_state_check",
      sql`${t.ordinal} > 0 AND
        (${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}) AND
        (${t.sealPurgedAt} IS NULL OR ${t.sealPurgedAt} >= ${t.sealPurgeAfter}) AND
        CASE coalesce(${t.outcome}, 'open')
          WHEN 'open' THEN ${t.finishedAt} IS NULL AND ${t.issue} IS NULL AND ${t.sealPurgeAfter} IS NULL
          WHEN 'ready' THEN ${t.finishedAt} IS NOT NULL AND ${t.issue} IS NULL AND ${t.sealPurgeAfter} IS NULL
          WHEN 'failed' THEN ${t.finishedAt} IS NOT NULL AND ${t.issue} IS NOT NULL AND ${t.sealPurgeAfter} IS NOT NULL
          WHEN 'cancelled' THEN ${t.finishedAt} IS NOT NULL AND ${t.issue} IS NOT NULL AND ${t.sealPurgeAfter} IS NOT NULL
          ELSE false END`,
    ),
  ],
);

export const inventoryExportRequests = pgTable(
  "inventory_release_export_requests",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    kind: text("kind").$type<"prepare" | "queue" | "retry">().notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => inventoryExportJobs.id),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "inventory_release_export_requests_pk",
      columns: [t.actorId, t.requestId, t.kind],
    }),
    check(
      "inventory_release_export_requests_header_check",
      sql`${t.kind} IN ('prepare','queue','retry') AND ${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type ExportJobRow = typeof inventoryExportJobs.$inferSelect;
export type ExportFileRow = typeof inventoryExportFiles.$inferSelect;
