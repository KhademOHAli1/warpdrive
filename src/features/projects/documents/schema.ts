import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { ProjectDocumentVisibility } from "./contracts";

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
