import { describe, expect, it } from "vitest";
import { buildScopeDraftPlan } from "./scopeDraft";
import { draftDigest, draftId, scopeDraftFixture } from "./scopeDraftTestKit";

const signal = () => AbortSignal.timeout(5000);
function hashesDiffer(change: (value: ReturnType<typeof scopeDraftFixture>) => void) {
  const first = scopeDraftFixture();
  const second = structuredClone(first);
  change(second);
  const a = buildScopeDraftPlan(first.input, first.context, signal());
  const b = buildScopeDraftPlan(second.input, second.context, signal());
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (a.ok && b.ok) expect(b.value.sha256).not.toBe(a.value.sha256);
}

describe("draft semantic commitments", () => {
  it.each([
    ["caseId", draftId(91)],
    ["identityScopeVersion", 5],
    ["disclosureScopeRef", draftId(92)],
    ["disclosureRevision", 2],
    ["recipientVersion", 2],
    ["verificationVersion", 3],
    ["policyVersion", 2],
    ["policyGeneration", 2],
    ["registryVersion", 2],
    ["registryFingerprint", draftDigest("1")],
    ["catalogFingerprint", draftDigest("2")],
    ["sourceFingerprint", draftDigest("3")],
    ["mode", "portability"],
  ])("binds %s independently", (key, value) => {
    hashesDiffer((fixture) => {
      Reflect.set(fixture.input.binding, key, value);
      Reflect.set(fixture.context.binding, key, value);
    });
  });

  it("binds subject kind/reference without merging identities", () => {
    hashesDiffer((f) => {
      Reflect.set(f.input.binding.subject, "kind", "user");
      Reflect.set(f.context.binding.subject, "kind", "user");
    });
  });

  it.each([
    "source",
    "provenance",
    "adapter",
    "replacement",
    "decision",
    "third_party",
    "portability",
  ])("hashes exact %s metadata", (kind) => {
    hashesDiffer((f) => {
      const category = f.input.categories[0];
      const expected = f.context.categories[0];
      const record = category?.records[0];
      const source = expected?.records[0];
      if (
        category === undefined ||
        expected === undefined ||
        record === undefined ||
        source === undefined
      )
        return;
      if (kind === "source") {
        record.sourceFingerprint = draftDigest("4");
        source.sourceFingerprint = draftDigest("4");
      }
      if (kind === "provenance") {
        const a = record.provenance[0];
        const b = source.provenance[0];
        if (a !== undefined && b !== undefined) {
          a.sourceFingerprint = draftDigest("5");
          b.sourceFingerprint = draftDigest("5");
        }
      }
      if (kind === "adapter") {
        category.adapterVersion = 3;
        expected.adapterVersion = 3;
      }
      if (kind === "replacement") {
        const field = record.decisions[1];
        if (field !== undefined && "replacement" in field && field.replacement !== undefined)
          field.replacement.sha256 = draftDigest("6");
      }
      if (kind === "decision") category.decision.decisionRef = draftId(93);
      if (kind === "third_party") {
        const field = record.decisions[0];
        if (field !== undefined) field.thirdParty = "present";
      }
      if (kind === "portability") {
        const field = record.decisions[0];
        if (field !== undefined) field.portability = "ineligible";
      }
    });
  });

  it("denies bindings or snapshots that disagree with trusted coverage", () => {
    const f = scopeDraftFixture();
    f.input.binding.recipientVersion = 99;
    expect(buildScopeDraftPlan(f.input, f.context, signal())).toEqual({
      ok: false,
      error: "scope_binding_mismatch",
    });
    const g = scopeDraftFixture();
    const record = g.input.categories[0]?.records[0];
    if (record !== undefined) record.sourceFingerprint = draftDigest("7");
    expect(buildScopeDraftPlan(g.input, g.context, signal())).toEqual({
      ok: false,
      error: "scope_record_mismatch",
    });
  });
});
