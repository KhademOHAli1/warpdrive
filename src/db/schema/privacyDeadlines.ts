import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { privacyCases, privacyEncrypted } from "./privacyCases";
import { privacyPolicyVersions } from "./privacyPolicies";

export const privacyDeadlineRecords = pgTable(
  "privacy_deadline_records",
  {
    caseId: uuid("case_id")
      .primaryKey()
      .references(() => privacyCases.id),
    policyVersion: integer("policy_version")
      .notNull()
      .references(() => privacyPolicyVersions.version),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    originalDueAt: timestamp("original_due_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    snapshotEnc: privacyEncrypted("snapshot_enc").notNull(),
    extensionMonths: integer("extension_months").notNull().default(0),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("privacy_deadline_version", sql`${t.version} > 0 AND ${t.extensionMonths} >= 0`),
    check(
      "privacy_deadline_instants",
      sql`${t.originalDueAt} > ${t.receivedAt} AND ${t.dueAt} >= ${t.originalDueAt}`,
    ),
  ],
);

export const privacyDeadlineDecisions = pgTable(
  "privacy_deadline_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => privacyDeadlineRecords.caseId),
    commandId: text("command_id").notNull(),
    inputDigest: text("input_digest").notNull(),
    resultEnc: privacyEncrypted("result_enc").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("privacy_deadline_command_uq").on(t.caseId, t.commandId)],
);
