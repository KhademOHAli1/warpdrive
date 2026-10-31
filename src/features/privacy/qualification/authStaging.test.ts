import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prepareAuthStagingRun } from "./authStaging";

const signal = () => AbortSignal.timeout(1000);
const revision = "a".repeat(40);
const origin = "https://staging.example.com";
const now = new Date("2026-10-31T12:00:00Z");
const configured = () => ({
  environment: "installed",
  origin,
  revision,
  operatorRef: randomUUID(),
  secretStoreSetupRef: randomUUID(),
  recipientSetRef: randomUUID(),
  externalMailAuthorizationRef: randomUUID(),
  physicalDeviceSetRef: randomUUID(),
  testAccountSetRef: randomUUID(),
  deploymentEvidenceRef: randomUUID(),
});
const receipt = (gate: string, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  gate,
  origin,
  revision,
  level: "installed_claim",
  outcome: "passed",
  artifactSha256: "b".repeat(64),
  observedAt: "2026-10-31T11:00:00Z",
  locales: ["en", "fa", "de"],
  deviceKind: "physical",
  ...extra,
});

test("P29B: absent operator facts produce an actionable OPEN checklist without invented acceptance", () => {
  const result = prepareAuthStagingRun({}, signal(), now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toMatchObject({
    version: 1,
    status: "OPEN",
    accepted: false,
    evidenceLevel: "preparation_only",
  });
  expect(result.value.missingInputs).toEqual(
    expect.arrayContaining([
      "origin",
      "revision",
      "operatorRef",
      "secretStoreSetupRef",
      "recipientSetRef",
      "externalMailAuthorizationRef",
      "physicalDeviceSetRef",
      "testAccountSetRef",
      "deploymentEvidenceRef",
    ]),
  );
  expect(result.value.gates.every((gate) => gate.status === "OPEN")).toBe(true);
  expect(result.value.requiredLocales).toEqual(["en", "fa", "de"]);
  expect(result.value.preparedAt).toBe(now.toISOString());
  expect(result.value.command).toBe("privacy-staging-auth:prepare");
});

test("P29A/P29B: complete declarations and manual references require review and cannot automatically pass", () => {
  const result = prepareAuthStagingRun(
    { ...configured(), evidence: [receipt("physical_passkey"), receipt("smtp_tls")] },
    signal(),
    now,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.accepted).toBe(false);
  expect(result.value.status).toBe("OPEN");
  expect(result.value.gates.find((gate) => gate.id === "physical_passkey")?.status).toBe(
    "REVIEW_REQUIRED",
  );
  expect(result.value.gates.find((gate) => gate.id === "smtp_tls")?.status).toBe("REVIEW_REQUIRED");
});

test("P29B: synthetic receipts or a virtual device cannot satisfy installed physical-device evidence", () => {
  for (const evidence of [
    receipt("physical_passkey", { level: "synthetic" }),
    receipt("physical_passkey", { deviceKind: "virtual" }),
  ]) {
    const result = prepareAuthStagingRun({ ...configured(), evidence: [evidence] }, signal(), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gates.find((gate) => gate.id === "physical_passkey")?.status).toBe(
      "SYNTHETIC_ONLY",
    );
    expect(result.value.accepted).toBe(false);
  }
});

test("P29B/C03: stale revision, wrong origin, future evidence and incomplete locale coverage remain explicit", () => {
  const evidence = [
    receipt("https_origin", { revision: "c".repeat(40) }),
    receipt("session_cookies", { origin: "https://other.example.test" }),
    receipt("smtp_tls", { observedAt: "2027-01-01T00:00:00Z" }),
    receipt("localized_recovery", { locales: ["en"] }),
  ];
  const result = prepareAuthStagingRun({ ...configured(), evidence }, signal(), now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  for (const id of ["https_origin", "session_cookies", "smtp_tls", "localized_recovery"])
    expect(result.value.gates.find((gate) => gate.id === id)?.status).toBe("OPEN");
  expect(result.value.gates.find((gate) => gate.id === "localized_recovery")?.reasons).toContain(
    "locale_evidence_incomplete",
  );
});

test("P29B/C10: failed current receipts remain failed and sensitive or malformed config is rejected without echo", () => {
  const failed = prepareAuthStagingRun(
    { ...configured(), evidence: [receipt("external_reset_delivery", { outcome: "failed" })] },
    signal(),
    now,
  );
  expect(failed.ok).toBe(true);
  if (failed.ok) expect(failed.value.status).toBe("FAILED");
  for (const input of [
    { ...configured(), origin: "http://staging.example.test" },
    { ...configured(), origin: "PRIVATE-SENTINEL is not a URL" },
    { ...configured(), origin: "https://user:PRIVATE-SENTINEL@staging.example.test" },
    { ...configured(), origin: "https://staging.example.test/?token=PRIVATE-SENTINEL" },
    { ...configured(), smtpPassword: "PRIVATE-SENTINEL" },
    { ...configured(), revision: "main" },
  ]) {
    const result = prepareAuthStagingRun(input, signal(), now);
    expect(result).toEqual({ ok: false, error: "staging_input_invalid" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-SENTINEL");
  }
});

test("C06: cancellation is propagated before preparation", () => {
  expect(() => prepareAuthStagingRun({}, AbortSignal.abort(), now)).toThrow(
    expect.objectContaining({ name: "AbortError" }),
  );
});

test("P29B: a current recorded failure remains visible when other operator inputs are missing", () => {
  const result = prepareAuthStagingRun(
    { origin, revision, evidence: [receipt("smtp_tls", { outcome: "failed" })] },
    signal(),
    now,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.status).toBe("FAILED");
  const gate = result.value.gates.find((item) => item.id === "smtp_tls");
  expect(gate?.status).toBe("FAILED");
  expect(gate?.reasons).toContain("missing_input:secretStoreSetupRef");
});
