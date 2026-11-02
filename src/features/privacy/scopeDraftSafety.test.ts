import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { buildScopeDraftPlan } from "./scopeDraft";
import { draftId, scopeDraftFixture } from "./scopeDraftTestKit";

const signal = () => AbortSignal.timeout(5000);
describe("bounded unsealed draft metadata", () => {
  it("rejects inherited array getters before schema parsing can execute them", () => {
    const f = scopeDraftFixture();
    const category = f.input.categories[0];
    const record = category?.records[0];
    assert(category !== undefined && record !== undefined);
    let read = false;
    const inherited: Record<string, unknown> = {};
    Object.setPrototypeOf(inherited, Array.prototype);
    Object.defineProperty(inherited, "0", {
      get() {
        read = true;
        return record;
      },
    });
    const records: typeof category.records = [];
    records.length = 1;
    Object.setPrototypeOf(records, inherited);
    category.records = records;
    const result = buildScopeDraftPlan(f.input, f.context, signal());
    expect(read).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: "invalid_scope_draft",
    });
  });
  it("keeps unsupported empty categories visibly blocked", () => {
    const f = scopeDraftFixture();
    const context = {
      ...f.context,
      categories: [
        ...f.context.categories,
        {
          store: "auth_accounts",
          adapterVersion: 1,
          capability: "unsupported",
          enumeration: "unavailable",
          records: [],
        },
      ],
    };
    const input = {
      ...f.input,
      categories: [
        ...f.input.categories,
        {
          store: "auth_accounts",
          adapterVersion: 1,
          decision: {
            disposition: "unsupported",
            review: "reviewed",
            decisionRef: draftId(50),
            reason: "adapter_unavailable",
          },
          records: [],
        },
      ],
    };
    const result = buildScopeDraftPlan(input, context, signal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("unsealed");
    expect(result.value.blockers).toContainEqual({
      code: "unsupported_category",
      store: "auth_accounts",
    });
    expect(Object.isFrozen(result.value.blockers)).toBe(true);
  });

  it("preserves pending and third-party decisions as blockers", () => {
    const f = scopeDraftFixture();
    const field = f.input.categories[0]?.records[0]?.decisions[0];
    if (field !== undefined) {
      field.review = "pending";
      field.thirdParty = "present";
    }
    const result = buildScopeDraftPlan(f.input, f.context, signal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blockers.some((item) => item.code === "field_review_pending")).toBe(true);
    expect(result.value.blockers.some((item) => item.code === "third_party_unresolved")).toBe(true);
    expect(result.value.state).toBe("unsealed");
  });

  it("rejects forged authority and raw replacement/content objects", () => {
    const f = scopeDraftFixture();
    expect(buildScopeDraftPlan({ ...f.input, scopeApproved: true }, f.context, signal())).toEqual({
      ok: false,
      error: "invalid_scope_draft",
    });
    expect(
      buildScopeDraftPlan(f.input, { ...f.context, approvalId: draftId(51) }, signal()),
    ).toEqual({ ok: false, error: "invalid_scope_context" });
    const field = f.input.categories[0]?.records[0]?.decisions[1];
    if (field !== undefined && "replacement" in field && field.replacement !== undefined)
      Reflect.set(field.replacement, "text", "PRIVATE-REPLACEMENT-SENTINEL");
    const result = buildScopeDraftPlan(f.input, f.context, signal());
    expect(result).toEqual({ ok: false, error: "invalid_scope_draft" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
  });

  it("preflights category/record/field and string limits", () => {
    const f = scopeDraftFixture();
    expect(
      buildScopeDraftPlan(
        { ...f.input, categories: Array(129).fill(f.input.categories[0]) },
        f.context,
        signal(),
      ),
    ).toEqual({ ok: false, error: "scope_draft_limit" });
    const category = f.input.categories[0];
    expect(
      buildScopeDraftPlan(
        {
          ...f.input,
          categories: [{ ...category, records: Array(10001).fill(category?.records[0]) }],
        },
        f.context,
        signal(),
      ),
    ).toEqual({ ok: false, error: "scope_draft_limit" });
    expect(
      buildScopeDraftPlan({ ...f.input, unknown: "x".repeat(257) }, f.context, signal()),
    ).toEqual({ ok: false, error: "scope_draft_limit" });
  });

  it("does not invoke input getters and propagates required cancellation", () => {
    const f = scopeDraftFixture();
    let read = false;
    Object.defineProperty(f.input, "secret", {
      enumerable: true,
      get() {
        read = true;
        return "PRIVATE";
      },
    });
    expect(buildScopeDraftPlan(f.input, f.context, signal())).toEqual({
      ok: false,
      error: "invalid_scope_draft",
    });
    expect(read).toBe(false);
    expect(() => buildScopeDraftPlan(f.input, f.context, AbortSignal.abort())).toThrow();
    expect(read).toBe(false);
  });
});
