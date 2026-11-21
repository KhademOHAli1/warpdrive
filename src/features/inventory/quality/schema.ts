import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "../production/buildSchema";
import { inventoryProductReleases } from "../releases/schema";
import { inventoryStockPositions } from "../warehouse/schema";
import {
  maxQualityEvidenceBytes,
  type QualityResultLine,
  type QualityTargetStatus,
} from "./contracts";
import { inventoryQualityPlanVersions } from "./planSchema";

export const inventoryQualityTargets = pgTable(
  "inventory_quality_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id").notNull(),
    siteId: uuid("site_id").notNull(),
    itemId: uuid("item_id").notNull(),
    buildId: uuid("build_id").notNull(),
    outputId: uuid("output_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    planVersionId: uuid("plan_version_id").notNull(),
    serial: text("serial").notNull(),
    lot: text("lot"),
    status: text("status").$type<QualityTargetStatus>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_quality_target_position_key").on(t.positionId),
    index("inventory_quality_targets_site_idx").on(t.siteId, t.createdAt.desc(), t.id),
    index("inventory_quality_targets_build_idx").on(t.buildId),
    foreignKey({
      name: "inventory_quality_target_position_fk",
      columns: [t.positionId, t.itemId],
      foreignColumns: [inventoryStockPositions.id, inventoryStockPositions.itemId],
    }),
    foreignKey({
      name: "inventory_quality_target_build_site_fk",
      columns: [t.buildId, t.siteId],
      foreignColumns: [inventoryProductionBuilds.id, inventoryProductionBuilds.siteId],
    }),
    foreignKey({
      name: "inventory_quality_target_build_release_fk",
      columns: [t.buildId, t.itemId, t.releaseId],
      foreignColumns: [
        inventoryProductionBuilds.id,
        inventoryProductionBuilds.itemId,
        inventoryProductionBuilds.releaseId,
      ],
    }),
    foreignKey({
      name: "inventory_quality_target_output_fk",
      columns: [t.outputId, t.itemId],
      foreignColumns: [inventoryProductionOutputs.id, inventoryProductionOutputs.itemId],
    }),
    foreignKey({
      name: "inventory_quality_target_release_fk",
      columns: [t.releaseId, t.itemId],
      foreignColumns: [inventoryProductReleases.id, inventoryProductReleases.itemId],
    }),
    foreignKey({
      name: "inventory_quality_target_plan_fk",
      columns: [t.planVersionId, t.itemId],
      foreignColumns: [inventoryQualityPlanVersions.id, inventoryQualityPlanVersions.itemId],
    }),
    check(
      "inventory_quality_target_status_check",
      sql`${t.status} IN ('pending','failed','passed')`,
    ),
  ],
);

export type QualityTargetRow = typeof inventoryQualityTargets.$inferSelect;

export const inventoryQualityRuns = pgTable(
  "inventory_quality_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => inventoryQualityTargets.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    actorName: text("actor_name").notNull(),
    station: text("station").notNull(),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    results: jsonb("results").$type<Omit<QualityResultLine, "evidence">[]>().notNull(),
    passed: boolean("passed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_quality_run_request_key").on(t.actorId, t.requestId),
    unique("inventory_quality_run_target_key").on(t.id, t.targetId),
    index("inventory_quality_runs_history_idx").on(t.targetId, t.createdAt.desc(), t.id),
    check("inventory_quality_run_station_check", sql`length(${t.station}) BETWEEN 1 AND 100`),
  ],
);

export const inventoryQualityEvidence = pgTable(
  "inventory_quality_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => inventoryQualityTargets.id),
    key: uuid("step_key").notNull(),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type").notNull(),
    stagingKey: text("staging_key").notNull(),
    objectKey: text("object_key"),
    sha256: text("sha256"),
    etag: text("etag"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_quality_evidence_target_step_key").on(t.id, t.targetId, t.key),
    unique("inventory_quality_evidence_staging_key").on(t.stagingKey),
    unique("inventory_quality_evidence_object_key").on(t.objectKey),
    check(
      "inventory_quality_evidence_size_check",
      sql`${t.sizeBytes} BETWEEN 1 AND ${sql.raw(String(maxQualityEvidenceBytes))}`,
    ),
    check(
      "inventory_quality_evidence_sealed_check",
      sql`CASE WHEN ${t.objectKey} IS NULL THEN ${t.sha256} IS NULL AND ${t.etag} IS NULL
        ELSE ${t.sha256} IS NOT NULL AND ${t.sha256} ~ '^[0-9a-f]{64}$' AND ${t.etag} IS NOT NULL END`,
    ),
  ],
);

export const inventoryQualityRunEvidence = pgTable(
  "inventory_quality_run_evidence",
  {
    evidenceId: uuid("evidence_id").primaryKey(),
    runId: uuid("run_id").notNull(),
    targetId: uuid("target_id").notNull(),
    key: uuid("step_key").notNull(),
  },
  (t) => [
    index("inventory_quality_run_evidence_run_idx").on(t.runId),
    foreignKey({
      name: "inventory_quality_run_evidence_run_fk",
      columns: [t.runId, t.targetId],
      foreignColumns: [inventoryQualityRuns.id, inventoryQualityRuns.targetId],
    }),
    foreignKey({
      name: "inventory_quality_run_evidence_identity_fk",
      columns: [t.evidenceId, t.targetId, t.key],
      foreignColumns: [
        inventoryQualityEvidence.id,
        inventoryQualityEvidence.targetId,
        inventoryQualityEvidence.key,
      ],
    }),
  ],
);
