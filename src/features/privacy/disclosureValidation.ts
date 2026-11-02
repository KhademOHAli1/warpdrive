import { err, ok, type Result } from "@/types/result";
import type { DisclosureCategory, DisclosureContext } from "./disclosureSchemas";

export type DisclosureFailure =
  | "invalid_context"
  | "invalid_manifest"
  | "manifest_limit"
  | "stale_scope"
  | "scope_unapproved"
  | "verification_required"
  | "policy_disabled"
  | "category_mismatch"
  | "decision_mismatch"
  | "record_mismatch"
  | "review_required"
  | "portability_ineligible"
  | "security_material"
  | "third_party_review_required"
  | "redaction_required"
  | "mime_unavailable"
  | "unsafe_archive_path"
  | "adapter_unavailable"
  | "mode_mismatch";

export function disclosureExclusionAllowed(
  mode: "access" | "portability",
  reason: string,
): boolean {
  return reason !== "not_portable" || mode === "portability";
}
const SECURITY_STORES = new Set([
  "auth_accounts",
  "auth_verifications",
  "auth_two_factors",
  "auth_passkeys",
  "sessions",
  "auth_invitations",
  "auth_email_verification_tokens",
  "auth_totp_replays",
  "oauth_access_tokens",
  "oauth_auth_codes",
  "oauth_refresh_tokens",
  "ws_tickets",
  "auth_mail_outbox",
  "auth_integration_revocations",
  "email_accounts",
  "enrichment_providers",
  "privacy_case_verifications",
  "privacy_authority",
  "privacy_case_members",
  "privacy_jobs",
  "privacy_policy_drafts",
  "privacy_policy_versions",
  "privacy_deadline_decisions",
  "privacy_deadline_records",
  "privacy_cases",
  "privacy_case_events",
]);
export function sameDisclosureIds(actual: readonly string[], expected: readonly string[]): boolean {
  const wanted = new Set(expected);
  return (
    wanted.size === expected.length &&
    actual.length === wanted.size &&
    new Set(actual).size === actual.length &&
    actual.every((id) => wanted.has(id))
  );
}

function mimeReviewed(category: Extract<DisclosureCategory, { disposition: "include" }>): boolean {
  const originals = category.files.filter((file) => file.representation === "original_eml");
  const reconstructed = category.files.filter(
    (file) => file.representation === "reconstructed_eml",
  );
  if (category.email.exported === "original")
    return (
      category.email.original === "available" && originals.length > 0 && reconstructed.length === 0
    );
  if (category.email.exported === "reconstructed")
    return (
      category.email.original !== "not_applicable" &&
      reconstructed.length > 0 &&
      originals.length === 0 &&
      category.transformations.includes("reconstructed_mime")
    );
  return (
    originals.length === 0 &&
    reconstructed.length === 0 &&
    (category.email.exported !== "not_applicable" || category.email.original === "not_applicable")
  );
}

function recordsMatch(
  category: Extract<DisclosureCategory, { disposition: "include" }>,
  expected: readonly string[],
): boolean {
  const ids: string[] = [];
  for (const file of category.files) {
    if (file.recordIds.length === 0 || new Set(file.recordIds).size !== file.recordIds.length)
      return false;
    ids.push(...file.recordIds);
  }
  return sameDisclosureIds([...new Set(ids)], expected);
}

function decisionSignature(
  decision: DisclosureContext["expectedCategories"][number]["decision"],
): string {
  const common = [decision.disposition, decision.reviewed, decision.reviewId];
  if (decision.disposition === "include")
    return JSON.stringify([
      ...common,
      decision.thirdParty,
      decision.portabilityEligible,
      decision.transformations,
      decision.email.original,
      decision.email.exported,
    ]);
  if (decision.disposition === "exclude") return JSON.stringify([...common, decision.reason]);
  return JSON.stringify([...common, decision.reason, decision.task]);
}

function validateIncludedCategory(
  category: Extract<DisclosureCategory, { disposition: "include" }>,
  expected: DisclosureContext["expectedCategories"][number],
  mode: "access" | "portability",
): Result<true, DisclosureFailure> {
  if (SECURITY_STORES.has(category.sourceStore.replace(/^table:/u, "")))
    return err("security_material");
  if (expected.capability !== "supported") return err("adapter_unavailable");
  if (mode === "portability" && !category.portabilityEligible) return err("portability_ineligible");
  if (category.thirdParty === "pending") return err("third_party_review_required");
  if (
    category.thirdParty === "redacted" &&
    !category.transformations.includes("third_party_redaction")
  )
    return err("redaction_required");
  if (!recordsMatch(category, expected.recordIds)) return err("record_mismatch");
  if (!mimeReviewed(category)) return err("mime_unavailable");
  return ok(true);
}

export function validateDisclosureCategory(
  category: DisclosureCategory,
  expected: DisclosureContext["expectedCategories"][number],
  mode: "access" | "portability",
): Result<true, DisclosureFailure> {
  if (category.id !== expected.id || category.sourceStore !== expected.sourceStore)
    return err("category_mismatch");
  if (decisionSignature(category) !== decisionSignature(expected.decision))
    return err("decision_mismatch");
  if (category.disposition === "unsupported") return ok(true);
  if (!category.reviewed) return err("review_required");
  if (category.disposition === "exclude")
    return disclosureExclusionAllowed(mode, category.reason) ? ok(true) : err("review_required");
  return validateIncludedCategory(category, expected, mode);
}
