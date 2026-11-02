import {
  bigint,
  boolean,
  customType,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ProjectState } from "../projectLifecycle";

type UnarchivedProjectState = Exclude<ProjectState, "archived">;
type ProjectOperation = "create" | "start";
type ReplayPayloadState = "retained" | "cleared" | "unreadable" | "disposed";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// Private query mappings only. The reviewed SQL overlay owns physical constraints and triggers.
export const agencyProjects = pgTable("agency_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  ownerUserId: uuid("owner_user_id").notNull(),
  dealId: uuid("deal_id"),
  personId: uuid("person_id"),
  orgId: uuid("org_id"),
  state: text("state").$type<ProjectState>().notNull().default("planned"),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  archivedFrom: text("archived_from").$type<UnarchivedProjectState>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agencyProjectMembers = pgTable(
  "agency_project_members",
  {
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id").notNull(),
    projectEdit: boolean("project_edit").notNull().default(false),
    assignmentCoordinate: boolean("assignment_coordinate").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] })],
);

export const agencyProjectHistory = pgTable("agency_project_history", {
  id: uuid("id").primaryKey().defaultRandom(),
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
});

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
  (table) => [primaryKey({ columns: [table.actorUserId, table.operation, table.intentId] })],
);
