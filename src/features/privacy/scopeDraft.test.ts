import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildScopeDraftPlan } from "./scopeDraft";
import { scopeDraftFixture } from "./scopeDraftTestKit";

const signal = () => AbortSignal.timeout(5000);

describe("canonical reviewed-scope draft", () => {
  it("returns only an explicitly unsealed immutable snapshot with matching UTF-8 hash", () => {
    const { input, context } = scopeDraftFixture();
    const result = buildScopeDraftPlan(input, context, signal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const draft = result.value;
    expect(draft.state).toBe("unsealed");
    expect(draft.formatVersion).toBe(1);
    expect(draft.blockers).toEqual([]);
    expect(draft.byteLength).toBe(draft.canonicalBytes.byteLength);
    expect(createHash("sha256").update(draft.canonicalBytes).digest("hex")).toBe(draft.sha256);
    expect(new TextDecoder().decode(draft.canonicalBytes)).toBe(draft.canonicalJson);
    expect(draft.canonicalJson).not.toContain("approvalId");
    expect(draft.canonicalJson).not.toContain("scopeApproved");
    expect(draft).not.toHaveProperty("sealable");
    expect(draft).not.toHaveProperty("permission");
    expect(Object.isFrozen(draft)).toBe(true);
    const original = draft.canonicalJson;
    input.categories.reverse();
    context.binding.identityScopeVersion = 99;
    input.categories[0]?.records[0]?.decisions.reverse();
    const bytes = draft.canonicalBytes;
    bytes.fill(0);
    expect(draft.canonicalJson).toBe(original);
    expect(new TextDecoder().decode(draft.canonicalBytes)).toBe(original);
  });

  it("is invariant to unordered category, field-decision and trusted-field permutations", () => {
    const first = scopeDraftFixture();
    const second = structuredClone(first);
    second.input.categories.reverse();
    second.context.categories.reverse();
    second.input.categories
      .find((category) => category.store === "persons")
      ?.records[0]?.decisions.reverse();
    second.context.categories
      .find((category) => category.store === "persons")
      ?.records[0]?.fields.reverse();
    const a = buildScopeDraftPlan(first.input, first.context, signal());
    const b = buildScopeDraftPlan(second.input, second.context, signal());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.value.canonicalJson).toBe(a.value.canonicalJson);
  });

  it("rejects omitted and duplicated zero-record categories", () => {
    const missing = scopeDraftFixture();
    missing.input.categories.pop();
    expect(buildScopeDraftPlan(missing.input, missing.context, signal())).toEqual({
      ok: false,
      error: "scope_coverage_mismatch",
    });
    const duplicate = scopeDraftFixture();
    const empty = duplicate.input.categories[1];
    if (empty !== undefined) duplicate.input.categories.push(empty);
    expect(buildScopeDraftPlan(duplicate.input, duplicate.context, signal())).toEqual({
      ok: false,
      error: "scope_duplicate",
    });
  });

  it("rejects changed server-owned record mapping and missing field decisions", () => {
    const changed = scopeDraftFixture();
    const record = changed.input.categories[0]?.records[0];
    if (record !== undefined) record.locator.id = "00000000-0000-4000-8000-000000000099";
    expect(buildScopeDraftPlan(changed.input, changed.context, signal())).toEqual({
      ok: false,
      error: "scope_record_mismatch",
    });
    const missing = scopeDraftFixture();
    missing.input.categories[0]?.records[0]?.decisions.pop();
    expect(buildScopeDraftPlan(missing.input, missing.context, signal())).toEqual({
      ok: false,
      error: "scope_coverage_mismatch",
    });
  });
});
