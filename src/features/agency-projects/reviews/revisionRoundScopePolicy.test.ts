import { describe, expect, it } from "vitest";
import {
  evaluateRevisionRoundScope,
  parseRevisionRoundAllowance,
  parseRevisionRoundDeclaration,
} from "./revisionRoundScope";
import {
  agreed,
  deliverableId,
  projectId,
  round,
  unknownAllowance,
} from "./revisionRoundScope.test-support";

describe("contextual comparison against supplied recorded allowance terms", () => {
  it("distinguishes unknown, agreed zero and an explicitly included first round", () => {
    for (const [allowance, classification] of [
      [unknownAllowance(), "allowance-unknown"],
      [agreed(0), "scope-review-required"],
      [agreed(1), "contextual-included"],
    ] as const) {
      expect(evaluateRevisionRoundScope(round(), allowance)).toEqual({
        ok: true,
        value: { projectId, deliverableId, roundNumber: 1, allowanceVersion: 2, classification },
      });
    }
  });

  it("includes the recorded limit and requires scope review for the next declared round", () => {
    expect(evaluateRevisionRoundScope(round(2), agreed(2))).toEqual({
      ok: true,
      value: {
        projectId,
        deliverableId,
        roundNumber: 2,
        allowanceVersion: 2,
        classification: "contextual-included",
      },
    });
    expect(evaluateRevisionRoundScope(round(3), agreed(2))).toMatchObject({
      ok: true,
      value: { roundNumber: 3, classification: "scope-review-required" },
    });
  });

  it("rejects another target or supplied-version mismatch before classification", () => {
    for (const field of ["projectId", "deliverableId"] as const) {
      expect(evaluateRevisionRoundScope(round(), {
        ...agreed(),
        [field]: "fabcdefa-6789-4bcd-9efa-678901234abc",
      })).toEqual({ ok: false, error: "round_scope_target_conflict" });
    }
    for (const allowance of [agreed(0), unknownAllowance()]) {
      expect(evaluateRevisionRoundScope(round(), { ...allowance, version: 3 }))
        .toEqual({ ok: false, error: "round_scope_version_conflict" });
    }
  });

  it("returns stable minimal assessments without private provenance or financial claims", () => {
    const result = evaluateRevisionRoundScope(round(), agreed());
    expect(result).toEqual({
      ok: true,
      value: {
        projectId,
        deliverableId,
        roundNumber: 1,
        allowanceVersion: 2,
        classification: "contextual-included",
      },
    });
    if (!result.ok) return;
    for (const field of [
      "recordedByUserId",
      "recordedAt",
      "agreementSource",
      "evidenceReference",
      "approvedExtraWork",
      "charge",
    ]) {
      expect(result.value).not.toHaveProperty(field);
    }
  });

  it("repeats comparisons without consuming rounds or mutating supplied terms", () => {
    const declaration = Object.freeze(round(2));
    const allowance = Object.freeze(agreed(2));
    const before = structuredClone({ declaration, allowance });
    const first = evaluateRevisionRoundScope(declaration, allowance);
    expect(first).toMatchObject({ ok: true, value: { classification: "contextual-included" } });
    expect(evaluateRevisionRoundScope(declaration, allowance)).toEqual(first);
    expect({ declaration, allowance }).toEqual(before);
  });

  it("does not reinterpret an old supplied pair after a different version is assessed", () => {
    const original = evaluateRevisionRoundScope(round(2), agreed(2));
    const changed = { ...agreed(0), version: 3 };
    expect(evaluateRevisionRoundScope({ ...round(2), expectedAllowanceVersion: 3 }, changed))
      .toMatchObject({ ok: true, value: { classification: "scope-review-required" } });
    expect(evaluateRevisionRoundScope(round(2), changed))
      .toEqual({ ok: false, error: "round_scope_version_conflict" });
    expect(evaluateRevisionRoundScope(round(2), agreed(2))).toEqual(original);
  });

  it("uses safe-integer bounds without imposing a round-history business cap", () => {
    const declaration = {
      ...round(Number.MAX_SAFE_INTEGER),
      expectedAllowanceVersion: Number.MAX_SAFE_INTEGER,
    };
    const allowance = { ...agreed(Number.MAX_SAFE_INTEGER), version: Number.MAX_SAFE_INTEGER };
    expect(parseRevisionRoundDeclaration(declaration)).toEqual({ ok: true, value: declaration });
    expect(parseRevisionRoundAllowance(allowance)).toEqual({ ok: true, value: allowance });
    expect(evaluateRevisionRoundScope(declaration, allowance)).toMatchObject({
      ok: true,
      value: { classification: "contextual-included" },
    });
  });
});
