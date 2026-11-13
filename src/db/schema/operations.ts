import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
import type { OperationsBatch, OperationsObservation } from "@/features/operations/contracts";

const time = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

/** Installation scope is selected from this singleton, never a request workspace ID. */
export const operationsInstallation = pgTable(
  "operations_installation",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    installationId: uuid("installation_id").notNull().defaultRandom().unique(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [check("operations_installation_singleton_ck", sql`${table.singleton} = true`)],
);

export const operationsSources = pgTable(
  "operations_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => operationsInstallation.installationId),
    role: text("role")
      .notNull()
      .$type<"host_collector" | "application_sampler" | "recovery_verifier">(),
    currentGenerationId: uuid("current_generation_id").notNull(),
    highestSequence: bigint("highest_sequence", { mode: "number" }).notNull().default(0),
    receiptOrdinal: bigint("receipt_ordinal", { mode: "number" }).notNull().default(0),
    admissionState: text("admission_state")
      .notNull()
      .default("ready")
      .$type<"ready" | "storage_pressure">(),
    active: boolean("active").notNull().default(true),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("operations_sources_installation_idx").on(table.installationId, table.id),
    check(
      "operations_sources_sequence_ck",
      sql`${table.highestSequence} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "operations_sources_ordinal_ck",
      sql`${table.receiptOrdinal} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "operations_sources_admission_ck",
      sql`${table.admissionState} IN ('ready','storage_pressure')`,
    ),
    check(
      "operations_sources_role_ck",
      sql`${table.role} IN ('host_collector','application_sampler','recovery_verifier')`,
    ),
  ],
);

/** Bounded receipt window. Current source high-water rejects expired identities. */
export const operationsReceipts = pgTable(
  "operations_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => operationsSources.id, { onDelete: "cascade" }),
    generationId: uuid("generation_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    ordinal: bigint("ordinal", { mode: "number" }).notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    payload: jsonb("payload").notNull().$type<OperationsBatch>(),
    observedAt: time("observed_at").notNull(),
    receivedAt: time("received_at").notNull(),
    observationCount: integer("observation_count").notNull(),
  },
  (table) => [
    index("operations_receipts_received_idx").on(table.sourceId, table.receivedAt, table.id),
    unique("operations_receipts_ordinal_uq").on(table.sourceId, table.ordinal),
    unique("operations_receipts_sequence_uq").on(
      table.sourceId,
      table.generationId,
      table.sequence,
    ),
    check("operations_receipts_sequence_ck", sql`${table.sequence} BETWEEN 1 AND 9007199254740991`),
    check("operations_receipts_ordinal_ck", sql`${table.ordinal} BETWEEN 1 AND 9007199254740991`),
    check("operations_receipts_fingerprint_ck", sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`),
    check("operations_receipts_count_ck", sql`${table.observationCount} BETWEEN 1 AND 100`),
  ],
);

export const operationsCurrent = pgTable(
  "operations_current",
  {
    sourceId: uuid("source_id")
      .notNull()
      .references(() => operationsSources.id, { onDelete: "cascade" }),
    observationKey: text("observation_key").notNull(),
    generationId: uuid("generation_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    receiptId: uuid("receipt_id").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    observation: jsonb("observation").notNull().$type<OperationsObservation>(),
    batchObservedAt: time("batch_observed_at").notNull(),
    orderingAt: time("ordering_at").notNull(),
    receivedAt: time("received_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.observationKey] }),
    check(
      "operations_current_key_ck",
      sql`char_length(${table.observationKey}) BETWEEN 1 AND 200 AND ${table.observationKey} ~ '^[a-z0-9_.:-]+$'`,
    ),
    check("operations_current_sequence_ck", sql`${table.sequence} BETWEEN 1 AND 9007199254740991`),
    check("operations_current_fingerprint_ck", sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const operationsIncidents = pgTable(
  "operations_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => operationsSources.id, { onDelete: "cascade" }),
    observationKey: text("observation_key").notNull(),
    state: text("state").notNull().$type<"degraded" | "failed" | "unknown" | "stale">(),
    reason: text("reason").notNull(),
    fingerprint: text("fingerprint").notNull(),
    revision: integer("revision").notNull(),
    openedAt: time("opened_at").notNull(),
    updatedAt: time("updated_at").notNull(),
    recoveredAt: time("recovered_at"),
  },
  (table) => [
    uniqueIndex("operations_incidents_open_uq")
      .on(table.sourceId, table.observationKey)
      .where(sql`${table.recoveredAt} IS NULL`),
    index("operations_incidents_updated_idx").on(table.updatedAt, table.id),
    check(
      "operations_incidents_state_ck",
      sql`${table.state} IN ('degraded','failed','unknown','stale')`,
    ),
    check("operations_incidents_reason_ck", sql`${table.reason} ~ '^[a-z_]{1,64}$'`),
    check("operations_incidents_fingerprint_ck", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check("operations_incidents_revision_ck", sql`${table.revision} BETWEEN 1 AND 1000000000`),
  ],
);

/** Revision uniqueness is the durable transition/delivery dedup namespace. Bell
 * recipients and delivery receipts remain a separate, explicitly authorized layer.
 */
export const operationsTransitions = pgTable(
  "operations_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => operationsIncidents.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    kind: text("kind").notNull().$type<"opened" | "changed" | "recovered">(),
    state: text("state").notNull(),
    reason: text("reason").notNull(),
    recordedAt: time("recorded_at").notNull(),
  },
  (table) => [
    unique("operations_transitions_revision_uq").on(table.incidentId, table.revision),
    check("operations_transitions_kind_ck", sql`${table.kind} IN ('opened','changed','recovered')`),
    check(
      "operations_transitions_state_ck",
      sql`${table.state} IN ('healthy','degraded','failed','unknown','stale')`,
    ),
    check("operations_transitions_reason_ck", sql`${table.reason} ~ '^[a-z_]{1,64}$'`),
  ],
);
