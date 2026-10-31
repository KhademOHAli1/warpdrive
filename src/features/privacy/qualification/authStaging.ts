import { err, ok } from "@/types/result";
import {
  AUTH_STAGING_GATES,
  AUTH_STAGING_LOCALES,
  type AuthStagingConfig,
  type AuthStagingEvidence,
  type AuthStagingGate,
  authStagingSchema,
} from "./authStagingSchemas";

const INPUTS = [
  "origin",
  "revision",
  "operatorRef",
  "secretStoreSetupRef",
  "recipientSetRef",
  "externalMailAuthorizationRef",
  "physicalDeviceSetRef",
  "testAccountSetRef",
  "deploymentEvidenceRef",
] as const;
type InputKey = (typeof INPUTS)[number];
export type AuthStagingGateStatus = "OPEN" | "FAILED" | "SYNTHETIC_ONLY" | "REVIEW_REQUIRED";
export interface AuthStagingGateResult {
  id: AuthStagingGate;
  status: AuthStagingGateStatus;
  reasons: string[];
  evidenceIds: string[];
}
const BASE: readonly InputKey[] = ["origin", "revision", "operatorRef"];
const REQUIREMENTS: Record<AuthStagingGate, readonly InputKey[]> = {
  deployment_revision: [...BASE, "deploymentEvidenceRef"],
  https_origin: BASE,
  session_cookies: [...BASE, "secretStoreSetupRef", "testAccountSetRef"],
  smtp_tls: [...BASE, "secretStoreSetupRef"],
  external_reset_delivery: [
    ...BASE,
    "recipientSetRef",
    "externalMailAuthorizationRef",
    "testAccountSetRef",
    "secretStoreSetupRef",
  ],
  external_notice_delivery: [
    ...BASE,
    "recipientSetRef",
    "externalMailAuthorizationRef",
    "testAccountSetRef",
    "secretStoreSetupRef",
  ],
  physical_passkey: [...BASE, "physicalDeviceSetRef", "testAccountSetRef"],
  fallback_recovery: [...BASE, "physicalDeviceSetRef", "testAccountSetRef"],
  localized_recovery: [
    ...BASE,
    "recipientSetRef",
    "externalMailAuthorizationRef",
    "testAccountSetRef",
    "secretStoreSetupRef",
  ],
  origin_csrf: [...BASE, "testAccountSetRef"],
  expiry_replay: [...BASE, "recipientSetRef", "externalMailAuthorizationRef", "testAccountSetRef"],
  provider_boundary: [...BASE, "secretStoreSetupRef", "testAccountSetRef", "deploymentEvidenceRef"],
};

function receiptReasons(
  receipt: AuthStagingEvidence,
  config: AuthStagingConfig,
  now: Date,
): string[] {
  const reasons: string[] = [];
  if (receipt.revision !== config.revision) reasons.push("evidence_revision_mismatch");
  if (receipt.origin !== config.origin) reasons.push("evidence_origin_mismatch");
  if (new Date(receipt.observedAt) > now) reasons.push("evidence_from_future");
  if (
    receipt.gate === "localized_recovery" &&
    AUTH_STAGING_LOCALES.some((locale) => !receipt.locales.includes(locale))
  )
    reasons.push("locale_evidence_incomplete");
  return reasons;
}

function gateResult(
  id: AuthStagingGate,
  config: AuthStagingConfig,
  now: Date,
): AuthStagingGateResult {
  const reasons = REQUIREMENTS[id]
    .filter((key) => config[key] === null)
    .map((key) => `missing_input:${key}`);
  const receipts = config.evidence.filter((receipt) => receipt.gate === id);
  const current = receipts.filter((receipt) => {
    const invalid = receiptReasons(receipt, config, now);
    reasons.push(...invalid);
    return invalid.length === 0;
  });
  const evidenceIds = receipts.map((receipt) => receipt.id);
  if (current.some((receipt) => receipt.outcome === "failed"))
    return {
      id,
      status: "FAILED",
      reasons: [...new Set([...reasons, "recorded_check_failed"])],
      evidenceIds,
    };
  if (reasons.length > 0 || current.length === 0)
    return {
      id,
      status: "OPEN",
      reasons:
        current.length === 0
          ? [...new Set([...reasons, "installed_evidence_required"])]
          : [...new Set(reasons)],
      evidenceIds,
    };
  if (
    config.environment === "synthetic" ||
    current.every(
      (receipt) =>
        receipt.level === "synthetic" ||
        (id === "physical_passkey" && receipt.deviceKind !== "physical"),
    )
  )
    return {
      id,
      status: "SYNTHETIC_ONLY",
      reasons: ["synthetic_evidence_not_installed_acceptance"],
      evidenceIds,
    };
  return {
    id,
    status: "REVIEW_REQUIRED",
    reasons: ["declared_evidence_requires_operator_review"],
    evidenceIds,
  };
}

export function prepareAuthStagingRun(input: unknown, signal: AbortSignal, now = new Date()) {
  signal.throwIfAborted();
  const parsed = authStagingSchema.safeParse(input);
  if (!parsed.success) return err("staging_input_invalid" as const);
  const config = parsed.data;
  const gates = AUTH_STAGING_GATES.map((gate) => {
    signal.throwIfAborted();
    return gateResult(gate, config, now);
  });
  return ok({
    version: 1 as const,
    command: "privacy-staging-auth:prepare" as const,
    preparedAt: now.toISOString(),
    evidenceLevel: "preparation_only" as const,
    status: gates.some((gate) => gate.status === "FAILED")
      ? ("FAILED" as const)
      : ("OPEN" as const),
    accepted: false as const,
    expectedRevision: config.revision,
    origin: config.origin,
    requiredLocales: [...AUTH_STAGING_LOCALES],
    missingInputs: INPUTS.filter((key) => config[key] === null),
    gates,
    prohibitedEffects: [
      "external_mail",
      "credential_mutation",
      "deployment",
      "automatic_acceptance",
    ],
  });
}
