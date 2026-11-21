import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sessions, users } from "@/db/schema/identity";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { ProjectDocumentVisibility } from "./contracts";
import type { ProjectDocumentCursor } from "./live/contracts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const internalProjectDocuments = pgTable(
  "internal_project_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => agencyProjects.id, { onDelete: "restrict" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createIntentId: uuid("create_intent_id").notNull(),
    title: text("title").notNull(),
    visibility: text("visibility").$type<ProjectDocumentVisibility>().notNull(),
    bodyHtml: text("body_html").notNull().default(""),
    collaborationState: bytea("collaboration_state"),
    collaborationEpoch: bigint("collaboration_epoch", { mode: "number" }).notNull().default(0),
    locked: boolean("locked").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("internal_project_documents_create_intent_key").on(
      table.projectId,
      table.authorUserId,
      table.createIntentId,
    ),
    check(
      "internal_project_documents_title_check",
      sql`public.agency_project_title_valid(${table.title})`,
    ),
    check(
      "internal_project_documents_visibility_check",
      sql`${table.visibility} IN ('project', 'private')`,
    ),
    check(
      "internal_project_documents_revision_check",
      sql`${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check("internal_project_documents_body_check", sql`octet_length(${table.bodyHtml}) <= 262144`),
    check(
      "internal_project_documents_collaboration_state_check",
      sql`octet_length(${table.collaborationState}) <= 1048576`,
    ),
    check(
      "internal_project_documents_collaboration_epoch_check",
      sql`${table.collaborationEpoch} BETWEEN 0 AND 9007199254740991`,
    ),
    index("internal_project_documents_project_updated_idx").on(
      table.projectId,
      table.updatedAt.desc(),
      table.id,
    ),
  ],
);

export const internalProjectDocumentVersions = pgTable(
  "internal_project_document_versions",
  {
    documentId: uuid("document_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    bodyHtml: text("body_html").notNull(),
    editorUserId: uuid("editor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.revision] }),
    foreignKey({
      name: "internal_project_document_versions_document_fk",
      columns: [table.documentId],
      foreignColumns: [internalProjectDocuments.id],
    }).onDelete("restrict"),
    check(
      "internal_project_document_versions_title_check",
      sql`public.agency_project_title_valid(${table.title})`,
    ),
    check(
      "internal_project_document_versions_revision_check",
      sql`${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "internal_project_document_versions_body_check",
      sql`octet_length(${table.bodyHtml}) <= 262144`,
    ),
  ],
);

export const internalProjectDocumentPresence = pgTable(
  "internal_project_document_presence",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => internalProjectDocuments.id, { onDelete: "cascade" }),
    clientId: bigint("client_id", { mode: "number" }).notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    epoch: bigint("epoch", { mode: "number" }).notNull(),
    cursor: jsonb("cursor").$type<ProjectDocumentCursor>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.clientId] }),
    check(
      "internal_project_document_presence_client_id_check",
      sql`${table.clientId} BETWEEN 0 AND 4294967295`,
    ),
    check(
      "internal_project_document_presence_epoch_check",
      sql`${table.epoch} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "internal_project_document_presence_cursor_check",
      sql`pg_column_size(${table.cursor}) <= 512`,
    ),
    index("internal_project_document_presence_expiry_idx").on(table.expiresAt),
    index("internal_project_document_presence_session_idx").on(table.sessionId),
  ],
);
