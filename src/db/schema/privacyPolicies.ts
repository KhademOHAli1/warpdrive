import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { privacyEncrypted } from "./privacyCases";

export const privacyPolicyDrafts = pgTable(
  "privacy_policy_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revision: integer("revision").notNull().default(1),
    contentEnc: privacyEncrypted("content_enc").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("privacy_policy_draft_revision", sql`${t.revision} > 0`)],
);

export const privacyPolicyVersions = pgTable(
  "privacy_policy_versions",
  {
    version: integer("version").primaryKey(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => privacyPolicyDrafts.id),
    draftRevision: integer("draft_revision").notNull(),
    profileEnc: privacyEncrypted("profile_enc").notNull(),
    reviewEnc: privacyEncrypted("review_enc").notNull(),
    activatedBy: uuid("activated_by")
      .notNull()
      .references(() => users.id),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("privacy_policy_version", sql`${t.version} > 0 AND ${t.draftRevision} > 0`),
    uniqueIndex("privacy_policy_draft_activation_uq").on(t.draftId, t.draftRevision),
  ],
);

export const privacyPolicyState = pgTable(
  "privacy_policy_state",
  {
    id: boolean("id").primaryKey().default(true),
    version: integer("version").references(() => privacyPolicyVersions.version),
    generation: integer("generation").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("privacy_policy_state_singleton", sql`${t.id} = true`),
    check("privacy_policy_state_generation", sql`${t.generation} > 0`),
  ],
);
