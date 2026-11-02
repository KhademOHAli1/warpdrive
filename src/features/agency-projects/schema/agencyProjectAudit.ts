import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import type { ProjectState } from "../projectLifecycle";
import { agencyProjects } from "./agencyProjects";

type UnarchivedProjectState = Exclude<ProjectState, "archived">;
type ProjectOperation = "create" | "start";
type ReplayPayloadState = "retained" | "cleared" | "unreadable" | "disposed";
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// Append-only history and receipt identity guards remain manual SQL triggers. Their absence
// from table metadata must not be interpreted as permission to regenerate or omit them.
export const agencyProjectHistory = pgTable(
  "agency_project_history",
  {
    id: uuid("id").notNull().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    recordedByUserId: uuid("recorded_by_user_id").notNull(),
    operation: text("operation").$type<ProjectOperation>().notNull(),
    policyVersion: smallint("policy_version").notNull(),
    previousRevision: bigint("previous_revision", { mode: "number" }),
    revision: bigint("revision", { mode: "number" }).notNull(),
    previousState: text("previous_state").$type<ProjectState>(),
    state: text("state").$type<ProjectState>().notNull(),
    previousArchivedFrom: text("previous_archived_from").$type<UnarchivedProjectState>(),
    archivedFrom: text("archived_from").$type<UnarchivedProjectState>(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "agency_project_history_pkey", columns: [table.id] }),
    foreignKey({
      name: "agency_project_history_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "agency_project_history_recorded_by_user_id_fkey",
      columns: [table.recordedByUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    check("agency_history_operation_check", sql`${table.operation} IN ('create', 'start')`),
    check("agency_history_policy_check", sql`${table.policyVersion} = 1`),
    check("agency_history_revision_check", sql`${table.revision} BETWEEN 0 AND 9007199254740991`),
    check(
      "agency_history_previous_revision_check",
      sql`${table.previousRevision} IS NULL OR ${table.previousRevision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "agency_history_transition_check",
      sql`
      (${table.operation} = 'create' AND ${table.previousRevision} IS NULL AND ${table.revision} = 0
        AND ${table.previousState} IS NULL AND ${table.state} = 'planned'
        AND ${table.previousArchivedFrom} IS NULL AND ${table.archivedFrom} IS NULL)
      OR (${table.operation} = 'start' AND ${table.previousRevision} IS NOT NULL
        AND ${table.revision}::numeric = ${table.previousRevision}::numeric + 1
        AND ${table.previousState} IS NOT NULL AND ${table.previousState} = 'planned' AND ${table.state} = 'active'
        AND ${table.previousArchivedFrom} IS NULL AND ${table.archivedFrom} IS NULL)
    `,
    ),
    unique("agency_history_project_revision_key").on(table.projectId, table.revision),
    unique("agency_history_receipt_identity_key").on(
      table.projectId,
      table.revision,
      table.id,
      table.operation,
      table.recordedByUserId,
    ),
  ],
);

export const agencyProjectRequests = pgTable(
  "agency_project_requests",
  {
    actorUserId: uuid("actor_user_id").notNull(),
    operation: text("operation").$type<ProjectOperation>().notNull(),
    intentId: uuid("intent_id").notNull(),
    projectId: uuid("project_id").notNull(),
    resultRevision: bigint("result_revision", { mode: "number" }).notNull(),
    historyId: uuid("history_id").notNull(),
    payloadState: text("payload_state").$type<ReplayPayloadState>().notNull(),
    privatePayload: bytea("private_payload"),
    keyId: text("key_id"),
  },
  (table) => [
    primaryKey({
      name: "agency_project_requests_pkey",
      columns: [table.actorUserId, table.operation, table.intentId],
    }),
    foreignKey({
      name: "agency_project_requests_actor_user_id_fkey",
      columns: [table.actorUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "agency_project_requests_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [agencyProjects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "agency_requests_history_identity_fk",
      columns: [
        table.projectId,
        table.resultRevision,
        table.historyId,
        table.operation,
        table.actorUserId,
      ],
      foreignColumns: [
        agencyProjectHistory.projectId,
        agencyProjectHistory.revision,
        agencyProjectHistory.id,
        agencyProjectHistory.operation,
        agencyProjectHistory.recordedByUserId,
      ],
    }).onDelete("restrict"),
    check("agency_requests_operation_check", sql`${table.operation} IN ('create', 'start')`),
    check(
      "agency_requests_revision_check",
      sql`${table.resultRevision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "agency_requests_payload_state_check",
      sql`${table.payloadState} IN ('retained', 'cleared', 'unreadable', 'disposed')`,
    ),
    check(
      "agency_requests_retained_payload_check",
      sql`
      ${table.payloadState} <> 'retained'
      OR (${table.privatePayload} IS NOT NULL AND octet_length(${table.privatePayload}) > 0
        AND ${table.keyId} IS NOT NULL AND btrim(${table.keyId}) <> '')
    `,
    ),
  ],
);

export type AgencyProjectHistoryRow = typeof agencyProjectHistory.$inferSelect;
export type NewAgencyProjectHistoryRow = typeof agencyProjectHistory.$inferInsert;
export type AgencyProjectRequest = typeof agencyProjectRequests.$inferSelect;
export type NewAgencyProjectRequest = typeof agencyProjectRequests.$inferInsert;
