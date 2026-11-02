import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { privacyCases, privacyEncrypted } from "./privacyCases";

// One current binding; immutable case events retain minimized, encrypted review receipts.
export const privacyCaseVerifications = pgTable(
  "privacy_case_verifications",
  {
    caseId: uuid("case_id")
      .primaryKey()
      .references(() => privacyCases.id),
    subjectKind: text("subject_kind"),
    subjectReferenceId: uuid("subject_reference_id"),
    subjectEnc: privacyEncrypted("subject_enc"),
    recipientEnc: privacyEncrypted("recipient_enc").notNull(),
    recipientDigest: text("recipient_digest").notNull(),
    evidenceEnc: privacyEncrypted("evidence_enc"),
    method: text("method"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    scopeVersion: integer("scope_version").notNull(),
    recipientVersion: integer("recipient_version").notNull(),
    verificationVersion: integer("verification_version").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "privacy_verification_versions",
      sql`${t.scopeVersion} > 0 AND ${t.recipientVersion} > 0 AND ${t.verificationVersion} > 0`,
    ),
    check(
      "privacy_verification_subject",
      sql`${t.subjectKind} IS NULL OR ${t.subjectKind} IN ('user','contact','external')`,
    ),
    check(
      "privacy_verification_method",
      sql`${t.method} IS NULL OR ${t.method} IN ('operator_review','authenticated_self')`,
    ),
    check(
      "privacy_verification_complete",
      sql`${t.verifiedAt} IS NULL OR (${t.verifiedBy} IS NOT NULL AND ${t.method} IS NOT NULL AND ${t.subjectKind} IS NOT NULL AND ${t.subjectEnc} IS NOT NULL AND ${t.evidenceEnc} IS NOT NULL AND length(${t.recipientDigest}) > 0 AND ((${t.subjectKind} = 'external' AND ${t.subjectReferenceId} IS NULL) OR (${t.subjectKind} IN ('user','contact') AND ${t.subjectReferenceId} IS NOT NULL)))`,
    ),
  ],
);
