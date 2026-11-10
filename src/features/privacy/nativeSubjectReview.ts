import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  privacyCaseVerifications,
} from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import { currentPrivacySession } from "./authoritySession";
import { privacyStorageOperation } from "./casePersistence";
import { privacyIntakeSchema } from "./caseSchemas";
import { fingerprintPrivacy } from "./crypto";
import { DISCOVERY_COVERAGE } from "./discoveryCoverage";
import { decodeIdentity } from "./identityPersistence";
import { loadNativeSubjectProjection } from "./nativeSubjectProjection";
import type {
  PrivacyNativeSubjectReview,
  PrivacyNativeSubjectReviewFailure,
} from "./nativeSubjectReviewTypes";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";
import { readPrivacyPolicyRevision } from "./policyStorage";
import { canonicalScopeJson } from "./scopeDraftCanonical";

const inputSchema = z.strictObject({ caseId: z.uuid() });

async function canReview(db: Db, actor: PrivacyActor, caseId: string, signal: AbortSignal) {
  const [authority] = await db
    .select({ capabilities: privacyAuthority.capabilities })
    .from(privacyAuthority)
    .where(eq(privacyAuthority.userId, actor.userId));
  signal.throwIfAborted();
  const [member] = await db
    .select({ capabilities: privacyCaseMembers.capabilities })
    .from(privacyCaseMembers)
    .where(and(eq(privacyCaseMembers.caseId, caseId), eq(privacyCaseMembers.userId, actor.userId)));
  signal.throwIfAborted();
  // The enclosing authority transaction already locks both current rows and checks revocation.
  return (
    authority?.capabilities.includes("case.review") === true &&
    member?.capabilities.includes("case.review") === true
  );
}

function unresolvedCoverage(store: "persons" | "users"): PrivacyNativeSubjectReview["coverage"] {
  return [
    ...DISCOVERY_COVERAGE.map((entry) => ({
      store: entry.store,
      status: entry.status === "unsupported" ? ("unsupported" as const) : ("incomplete" as const),
      code:
        entry.store === store
          ? ("direct_subject_only" as const)
          : entry.status === "unsupported"
            ? ("adapter_unavailable" as const)
            : ("not_loaded" as const),
    })),
    { store: "pgboss-managed-schema", status: "unsupported", code: "adapter_unavailable" },
    {
      store: "object_versions_providers_backups",
      status: "unsupported",
      code: "adapter_unavailable",
    },
    { store: "reviewed_scope", status: "incomplete", code: "not_loaded" },
  ];
}

// This exact-subject preview grants no scope approval or complete disclosure coverage.
export async function loadPrivacyNativeSubjectReview(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
): Promise<Result<PrivacyNativeSubjectReview, PrivacyNativeSubjectReviewFailure>> {
  signal.throwIfAborted();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const { caseId } = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.disclose", caseId },
      signal,
      async (
        tx,
        ticket,
      ): Promise<Result<PrivacyNativeSubjectReview, PrivacyNativeSubjectReviewFailure>> => {
        if (!(await canReview(tx, actor, caseId, signal))) return err("forbidden");
        const [row] = await tx.select().from(privacyCases).where(eq(privacyCases.id, caseId));
        signal.throwIfAborted();
        if (row === undefined) return err("forbidden");
        if (row.status !== "under_review" || (row.kind !== "access" && row.kind !== "portability"))
          return err("case_not_reviewable");
        if (ticket.activePolicyVersion === null) return err("policy_unconfigured");
        if (row.policyVersion !== ticket.activePolicyVersion) return err("policy_stale");
        const policy = await readPrivacyPolicyRevision(tx, ticket.activePolicyVersion, signal);
        if (!policy.ok)
          return err(
            policy.error === "policy_unconfigured" ? "policy_unconfigured" : "storage_unavailable",
          );
        if (!policy.value.profile.rights.disclosureEnabled) return err("policy_disabled");
        const [proof] = await tx
          .select({ subjectEnc: privacyCaseVerifications.subjectEnc })
          .from(privacyCaseVerifications)
          .where(eq(privacyCaseVerifications.caseId, caseId));
        signal.throwIfAborted();
        if (proof?.subjectEnc === undefined || proof.subjectEnc === null) return err("forbidden");
        const subject = decodeIdentity(proof.subjectEnc, privacyIntakeSchema.shape.subject, caseId);
        if (!subject.ok) return err("forbidden");
        if (subject.value.kind === "external") return err("unsupported_subject");
        const projection = await loadNativeSubjectProjection(tx, subject.value, signal);
        signal.throwIfAborted();
        // A native source lock can outlive session freshness or expiry while authority rows stay locked.
        if (!(await currentPrivacySession(tx, actor, signal))) return err("forbidden");
        if (!projection.ok) return projection;
        const record = {
          adapterVersion: 1 as const,
          recordId: subject.value.referenceId,
          ...projection.value,
        };
        const sourceFingerprint = Buffer.from(
          fingerprintPrivacy(
            canonicalScopeJson({
              domain: "privacy-native-subject-projection:v1",
              ...record,
            }),
            { caseId, purpose: "decision" },
          ),
          "base64url",
        ).toString("hex");
        return ok({
          formatVersion: 1,
          state: "preliminary",
          complete: false,
          reviewRequired: true,
          binding: {
            caseId,
            caseVersion: row.version,
            subject: { kind: subject.value.kind, referenceId: subject.value.referenceId },
            identityScopeVersion: row.scopeVersion,
            recipientVersion: row.recipientVersion,
            verificationVersion: row.verificationVersion,
            policyVersion: ticket.activePolicyVersion,
            policyGeneration: ticket.policyGeneration,
          },
          record: { ...record, sourceFingerprint },
          coverage: unresolvedCoverage(record.store),
        });
      },
    ),
  );
}
