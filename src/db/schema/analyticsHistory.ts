import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type AnalyticsHistoryEntityKind = "deal" | "stage" | "pipeline";
export type AnalyticsHistoryEventKind = "baseline" | "insert" | "update" | "delete";
export type AnalyticsReportSnapshotKind = "pipeline-inventory" | "forecast";
export type AnalyticsCapturedState = Record<string, unknown>;

// PostgreSQL 16 supplies pg_snapshot and xid8-aware visibility functions. Keep its native
// text representation; it is not a date, event ordinal or list of currently live records.
const pgSnapshot = customType<{ data: string; driverData: string }>({
  dataType: () => "pg_snapshot",
});

// PRIVATE, source-only proposal. The unnumbered SQL owns capture/immutability triggers and
// atomic baseline installation. No canonical migration, export or runtime admission exists.
export const analyticsHistoryCoverage = pgTable(
  "analytics_history_coverage",
  {
    id: boolean("id").primaryKey().default(true),
    activationId: uuid("activation_id").notNull().defaultRandom(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }).notNull(),
    activationTransactionId: text("activation_transaction_id").notNull(),
    baselineSnapshot: pgSnapshot("baseline_snapshot").notNull(),
    baselineDealCount: bigint("baseline_deal_count", { mode: "bigint" }).notNull(),
    baselineStageCount: bigint("baseline_stage_count", { mode: "bigint" }).notNull(),
    baselinePipelineCount: bigint("baseline_pipeline_count", { mode: "bigint" }).notNull(),
    captureSemantics: text("capture_semantics").notNull().default("database-row-observation-v1"),
  },
  (t) => [
    uniqueIndex("analytics_history_coverage_activation_uq").on(t.activationId),
    check("analytics_history_coverage_singleton_ck", sql`${t.id}`),
    check("analytics_history_coverage_version_ck", sql`${t.schemaVersion} = 1`),
    check(
      "analytics_history_coverage_transaction_ck",
      sql`${t.activationTransactionId} ~ '^[0-9]{1,20}$'`,
    ),
    check(
      "analytics_history_coverage_counts_ck",
      sql`${t.baselineDealCount} >= 0 AND ${t.baselineStageCount} >= 0 AND ${t.baselinePipelineCount} >= 0`,
    ),
    check(
      "analytics_history_coverage_semantics_ck",
      sql`${t.captureSemantics} = 'database-row-observation-v1'`,
    ),
  ],
);

export const analyticsHistoryEvents = pgTable(
  "analytics_history_events",
  {
    // Shared across all entity kinds. BigInt mode avoids the JS safe-integer boundary.
    // Rollback gaps are expected; this order is not transaction commit order.
    ordinal: bigint("ordinal", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    eventId: uuid("event_id").notNull().defaultRandom(),
    activationId: uuid("activation_id").notNull(),
    entityKind: text("entity_kind").$type<AnalyticsHistoryEntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    incarnationId: uuid("incarnation_id").notNull(),
    eventKind: text("event_kind").$type<AnalyticsHistoryEventKind>().notNull(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    transactionId: text("transaction_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }).notNull(),
    observationSnapshot: pgSnapshot("observation_snapshot").notNull(),
    beforeState: jsonb("before_state").$type<AnalyticsCapturedState>(),
    afterState: jsonb("after_state").$type<AnalyticsCapturedState>(),
    beforeWriteVersion: uuid("before_write_version"),
    afterWriteVersion: uuid("after_write_version"),
    // Version 1 capture always leaves these unknown. Owner is never actor provenance.
    actorId: uuid("actor_id"),
    commandId: text("command_id"),
  },
  (t) => [
    foreignKey({
      name: "analytics_history_events_activation_fk",
      columns: [t.activationId],
      foreignColumns: [analyticsHistoryCoverage.activationId],
    }).onDelete("restrict"),
    uniqueIndex("analytics_history_events_event_uq").on(t.eventId),
    index("analytics_history_events_entity_idx").on(
      t.entityKind,
      t.entityId,
      t.incarnationId,
      t.ordinal,
    ),
    index("analytics_history_events_transaction_idx").on(t.transactionId, t.ordinal),
    index("analytics_history_events_observed_idx").on(t.activationId, t.observedAt, t.ordinal),
    check("analytics_history_events_ordinal_ck", sql`${t.ordinal} > 0`),
    check(
      "analytics_history_events_entity_ck",
      sql`${t.entityKind} IN ('deal','stage','pipeline')`,
    ),
    check(
      "analytics_history_events_kind_ck",
      sql`${t.eventKind} IN ('baseline','insert','update','delete')`,
    ),
    check("analytics_history_events_version_ck", sql`${t.schemaVersion} = 1`),
    check("analytics_history_events_transaction_ck", sql`${t.transactionId} ~ '^[0-9]{1,20}$'`),
    check(
      "analytics_history_events_projection_ck",
      sql`(${t.beforeState} IS NULL OR jsonb_typeof(${t.beforeState}) = 'object')
        AND (${t.afterState} IS NULL OR jsonb_typeof(${t.afterState}) = 'object')`,
    ),
    check(
      "analytics_history_events_shape_ck",
      sql`(${t.eventKind} IN ('baseline','insert') AND ${t.beforeState} IS NULL AND ${t.afterState} IS NOT NULL)
        OR (${t.eventKind} = 'update' AND ${t.beforeState} IS NOT NULL AND ${t.afterState} IS NOT NULL AND ${t.beforeState} IS DISTINCT FROM ${t.afterState})
        OR (${t.eventKind} = 'delete' AND ${t.beforeState} IS NOT NULL AND ${t.afterState} IS NULL)`,
    ),
  ],
);

export const analyticsHistoryHeads = pgTable(
  "analytics_history_heads",
  {
    entityKind: text("entity_kind").$type<AnalyticsHistoryEntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    activationId: uuid("activation_id").notNull(),
    incarnationId: uuid("incarnation_id").notNull(),
    active: boolean("active").notNull(),
    lastEventOrdinal: bigint("last_event_ordinal", { mode: "bigint" }).notNull(),
    lastWriteVersion: uuid("last_write_version"),
    incarnationStartedAt: timestamp("incarnation_started_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "analytics_history_heads_activation_fk",
      columns: [t.activationId],
      foreignColumns: [analyticsHistoryCoverage.activationId],
    }).onDelete("restrict"),
    primaryKey({ name: "analytics_history_heads_pkey", columns: [t.entityKind, t.entityId] }),
    uniqueIndex("analytics_history_heads_incarnation_uq").on(t.incarnationId),
    check("analytics_history_heads_entity_ck", sql`${t.entityKind} IN ('deal','stage','pipeline')`),
    check("analytics_history_heads_ordinal_ck", sql`${t.lastEventOrdinal} > 0`),
  ],
);

// Storage contract only. A future writer must capture source facts and MVCC visibility in
// one consistent observation, reject its own pending entity writes, and derive createdBy
// server-side. Every reader must reapply current visibility to stored constituents.
export const analyticsReportSnapshots = pgTable(
  "analytics_report_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id").notNull(),
    kind: text("kind").$type<AnalyticsReportSnapshotKind>().notNull(),
    definitionVersion: integer("definition_version").notNull(),
    reportDefinition: jsonb("report_definition").$type<Record<string, unknown>>().notNull(),
    modelVersion: text("model_version"),
    modelDefinition: jsonb("model_definition").$type<Record<string, unknown>>(),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
    currency: text("currency").notNull(),
    timeZone: text("time_zone").notNull(),
    calendar: text("calendar").$type<"gregory" | "persian">().notNull(),
    cutoffObservedAt: timestamp("cutoff_observed_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    transactionSnapshot: pgSnapshot("transaction_snapshot").notNull(),
    // Optional bound for scans, never the visibility membership criterion on its own.
    eventHighWaterOrdinal: bigint("event_high_water_ordinal", { mode: "bigint" }),
    targetFrom: date("target_from"),
    targetToExclusive: date("target_to_exclusive"),
    records: jsonb("records").$type<readonly Record<string, unknown>[]>().notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: "analytics_report_snapshots_activation_fk",
      columns: [t.activationId],
      foreignColumns: [analyticsHistoryCoverage.activationId],
    }).onDelete("restrict"),
    index("analytics_report_snapshots_creator_idx").on(t.createdBy, t.createdAt, t.id),
    check(
      "analytics_report_snapshots_kind_ck",
      sql`${t.kind} IN ('pipeline-inventory','forecast')`,
    ),
    check("analytics_report_snapshots_definition_ck", sql`${t.definitionVersion} > 0`),
    check("analytics_report_snapshots_currency_ck", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("analytics_report_snapshots_zone_ck", sql`length(${t.timeZone}) BETWEEN 1 AND 100`),
    check("analytics_report_snapshots_calendar_ck", sql`${t.calendar} IN ('gregory','persian')`),
    check(
      "analytics_report_snapshots_json_ck",
      sql`jsonb_typeof(${t.reportDefinition}) = 'object' AND jsonb_typeof(${t.scope}) = 'object'
        AND (${t.modelDefinition} IS NULL OR jsonb_typeof(${t.modelDefinition}) = 'object')
        AND jsonb_typeof(${t.records}) = 'array'`,
    ),
    check(
      "analytics_report_snapshots_period_ck",
      sql`(${t.targetFrom} IS NULL AND ${t.targetToExclusive} IS NULL)
        OR (${t.targetFrom} IS NOT NULL AND ${t.targetToExclusive} IS NOT NULL AND ${t.targetToExclusive} > ${t.targetFrom})`,
    ),
    check(
      "analytics_report_snapshots_forecast_ck",
      sql`${t.kind} <> 'forecast' OR
        (${t.modelVersion} IS NOT NULL AND length(${t.modelVersion}) > 0 AND ${t.modelDefinition} IS NOT NULL
          AND ${t.targetFrom} IS NOT NULL AND ${t.targetToExclusive} IS NOT NULL)`,
    ),
    check(
      "analytics_report_snapshots_watermark_ck",
      sql`${t.eventHighWaterOrdinal} IS NULL OR ${t.eventHighWaterOrdinal} > 0`,
    ),
  ],
);

export type AnalyticsHistoryEvent = typeof analyticsHistoryEvents.$inferSelect;
export type AnalyticsHistoryHead = typeof analyticsHistoryHeads.$inferSelect;
export type AnalyticsHistoryCoverage = typeof analyticsHistoryCoverage.$inferSelect;
export type AnalyticsReportSnapshot = typeof analyticsReportSnapshots.$inferSelect;
