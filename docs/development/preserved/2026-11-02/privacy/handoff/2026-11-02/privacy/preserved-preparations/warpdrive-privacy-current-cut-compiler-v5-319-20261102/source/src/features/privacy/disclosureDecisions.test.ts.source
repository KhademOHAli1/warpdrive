import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { buildDisclosureManifest } from "./disclosureManifest";
import {
  excludedDecision,
  fixture,
  includedDecision,
  signal,
  unsupportedDecision,
} from "./disclosureManifest.testHelpers";

test("C03: changing category review attestations cannot upgrade the same trusted scope", () => {
  const { input, context } = fixture({ contacts: { ...includedDecision(), reviewed: false } });
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "review_required",
  });
  if (input.categories[0] !== undefined) input.categories[0].reviewed = true;
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
});

test("C03/C10: third-party pending review cannot be cleared by input under the same scope", () => {
  const { input, context } = fixture({
    contacts: { ...includedDecision(), thirdParty: "pending" },
  });
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "third_party_review_required",
  });
  if (input.categories[0] !== undefined) input.categories[0].thirdParty = "none";
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
});

test("C03/C10: transformations and MIME availability are sealed category decisions", () => {
  const redaction = fixture({ contacts: { ...includedDecision(), thirdParty: "redacted" } });
  expect(buildDisclosureManifest(redaction.input, redaction.context, signal())).toEqual({
    ok: false,
    error: "redaction_required",
  });
  if (redaction.input.categories[0] !== undefined)
    redaction.input.categories[0].transformations = ["third_party_redaction"];
  expect(buildDisclosureManifest(redaction.input, redaction.context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
  const { input, context } = fixture();
  if (input.categories[2] !== undefined)
    input.categories[2].email = { original: "available", exported: "reconstructed" };
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
});

test("C03: excluded and unsupported dispositions cannot bypass decision equality", () => {
  const excluded = fixture({ derived: excludedDecision("policy_exception") });
  if (excluded.input.categories[1] !== undefined)
    excluded.input.categories[1].reason = "security_material";
  expect(buildDisclosureManifest(excluded.input, excluded.context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
  const unsupported = fixture({ derived: unsupportedDecision() });
  expect(buildDisclosureManifest(unsupported.input, unsupported.context, signal()).ok).toBe(true);
  if (unsupported.input.categories[1] !== undefined)
    unsupported.input.categories[1].task = "DPL-09";
  expect(buildDisclosureManifest(unsupported.input, unsupported.context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
  const changedDisposition = fixture({ derived: unsupportedDecision() });
  const derived = changedDisposition.input.categories[1];
  if (derived === undefined) return;
  changedDisposition.input.categories[1] = {
    id: "derived",
    sourceStore: "table:enrichment_runs",
    reviewed: derived.reviewed,
    reviewId: derived.reviewId,
    disposition: "exclude",
    reason: "policy_exception",
  };
  expect(
    buildDisclosureManifest(changedDisposition.input, changedDisposition.context, signal()),
  ).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
});

test("P08B: an unsupported trusted disposition stays blocked when input claims inclusion", () => {
  const { input, context } = fixture({ derived: unsupportedDecision() });
  const original = buildDisclosureManifest(input, context, signal());
  expect(original.ok && original.value.state).toBe("blocked");
  const derived = input.categories[1];
  const target = context.expectedCategories[1];
  if (derived === undefined || target === undefined) return;
  const recordId = target.recordIds[0];
  input.categories[1] = {
    ...includedDecision(),
    id: "derived",
    sourceStore: "table:enrichment_runs",
    reviewed: derived.reviewed,
    reviewId: derived.reviewId,
    files: [
      {
        path: `records/${recordId}/data.json`,
        sha256: "b".repeat(64),
        bytes: 1,
        recordIds: [recordId],
        representation: "json",
      },
    ],
  };
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
});

test("C03: category decisions are mandatory in the trusted context", () => {
  const { input, context } = fixture();
  const expectedCategories = context.expectedCategories.map((target) => ({
    id: target.id,
    sourceStore: target.sourceStore,
    capability: target.capability,
    recordIds: target.recordIds,
  }));
  expect(buildDisclosureManifest(input, { ...context, expectedCategories }, signal())).toEqual({
    ok: false,
    error: "invalid_context",
  });
});

test("P08A: input cannot claim portability eligibility absent the trusted category decision", () => {
  const { input, context } = fixture();
  input.mode = "portability";
  context.mode = "portability";
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "portability_ineligible",
  });
  if (input.categories[1] !== undefined) input.categories[1].portabilityEligible = true;
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
});

test("C03: input cannot replace a category review identifier", () => {
  const { input, context } = fixture();
  if (input.categories[0] !== undefined) input.categories[0].reviewId = randomUUID();
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "decision_mismatch",
  });
});

test("C01: every archive file must have approved nonempty record associations", () => {
  const { input, context } = fixture();
  const category = input.categories[0];
  if (category === undefined) return;
  const files = category.files as unknown[];
  files.push({
    path: `attachments/${context.binding.scopeId}/unscoped.pdf`,
    sha256: "b".repeat(64),
    bytes: 123,
    recordIds: [],
    representation: "attachment",
  });
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "record_mismatch",
  });
});

test("P08A: an approved empty category can have no archive files", () => {
  const { input, context } = fixture();
  if (context.expectedCategories[0] !== undefined) context.expectedCategories[0].recordIds = [];
  if (input.categories[0] !== undefined) input.categories[0].files = [];
  expect(buildDisclosureManifest(input, context, signal()).ok).toBe(true);
});
