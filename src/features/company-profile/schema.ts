import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { CompanyBrandingInput, CompanyProvenance } from "./contracts";

// Installation scoped, matching settings and the existing billing account.
// Private details, contacts, legal data and replay responses are authenticated ciphertext.
export const companyProfiles = pgTable(
  "company_profiles",
  {
    id: boolean("id").primaryKey().default(true),
    workspaceScope: uuid("workspace_scope").notNull().defaultRandom(),
    detailsCiphertext: text("details_ciphertext"),
    detailsRevision: integer("details_revision").notNull().default(0),
    branding: jsonb("branding")
      .$type<CompanyBrandingInput>()
      .notNull()
      .default({ iconAssetId: null, logoAssetId: null, accentColor: null, fit: "contain" }),
    brandingRevision: integer("branding_revision").notNull().default(0),
    payerCiphertext: text("payer_ciphertext"),
    payerRevision: integer("payer_revision").notNull().default(0),
    detailsProvenance: jsonb("details_provenance").$type<CompanyProvenance | null>(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("company_profiles_singleton", sql`${t.id} = true`),
    check(
      "company_profiles_revisions",
      sql`${t.detailsRevision} >= 0 AND ${t.brandingRevision} >= 0 AND ${t.payerRevision} >= 0`,
    ),
  ],
);

export const companyLegalEntities = pgTable(
  "company_legal_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revision: integer("revision").notNull().default(1),
    dataCiphertext: text("data_ciphertext").notNull(),
    provenance: jsonb("provenance").$type<CompanyProvenance>().notNull(),
    parentEntityId: uuid("parent_entity_id"),
    archived: boolean("archived").notNull().default(false),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("company_legal_entity_revision", sql`${t.revision} > 0`)],
);

export const companyOperations = pgTable("company_operations", {
  requestId: uuid("request_id").primaryKey(),
  actorId: uuid("actor_id").notNull(),
  kind: text("kind").notNull(),
  fingerprint: text("fingerprint").notNull(),
  responseCiphertext: text("response_ciphertext").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyAssets = pgTable(
  "company_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().unique(),
    createdBy: uuid("created_by").notNull(),
    slot: text("slot").notNull(),
    fingerprint: text("fingerprint").notNull(),
    objectKey: text("object_key").notNull().unique(),
    digest: text("digest").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    size: integer("size").notNull(),
    ready: boolean("ready").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("company_assets_slot", sql`${t.slot} IN ('icon','logo')`),
    check("company_assets_size", sql`${t.size} > 0 AND ${t.size} <= 2097152`),
  ],
);
