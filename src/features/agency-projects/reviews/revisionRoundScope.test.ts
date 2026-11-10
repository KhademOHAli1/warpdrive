import { describe, expect, it } from "vitest";
import { parseRevisionRoundAllowance, parseRevisionRoundDeclaration } from "./revisionRoundScope";
import {
  agreed,
  deliverableId,
  projectId,
  recorded,
  recorderId,
  round,
  unknownAllowance,
} from "./revisionRoundScope.test-support";

const invalidDeclaration = { ok: false, error: "invalid_round_declaration" };
const invalidAllowance = { ok: false, error: "invalid_round_allowance" };

describe("explicit revision-round declaration boundary", () => {
  it.each([null, undefined, 1, "1", [], {}])("rejects a malformed declaration: %s", (input) => {
    expect(parseRevisionRoundDeclaration(input)).toEqual(invalidDeclaration);
  });

  it("requires an explicit ordinal and selected allowance version", () => {
    expect(parseRevisionRoundDeclaration(round())).toEqual({ ok: true, value: round() });
    for (const field of ["roundNumber", "expectedAllowanceVersion"]) {
      const input = round();
      Reflect.deleteProperty(input, field);
      expect(parseRevisionRoundDeclaration(input)).toEqual(invalidDeclaration);
    }
  });

  it.each([0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    "rejects a nonpositive or unsafe ordinal/version: %s",
    (value) => {
      expect(parseRevisionRoundDeclaration({ ...round(), roundNumber: value })).toEqual(
        invalidDeclaration,
      );
      expect(
        parseRevisionRoundDeclaration({ ...round(), expectedAllowanceVersion: value }),
      ).toEqual(invalidDeclaration);
    },
  );

  it("canonicalizes target UUIDs without matching display names", () => {
    const input = {
      ...round(),
      projectId: projectId.toUpperCase(),
      deliverableId: deliverableId.toUpperCase(),
    };
    expect(parseRevisionRoundDeclaration(input)).toEqual({ ok: true, value: round() });
    for (const field of ["projectId", "deliverableId"]) {
      for (const value of ["same-title", "", null, undefined]) {
        expect(parseRevisionRoundDeclaration({ ...round(), [field]: value })).toEqual(
          invalidDeclaration,
        );
      }
    }
  });

  it("excludes native provenance and arbitrary work-version claims from the declaration", () => {
    for (const extra of [
      { recordedByUserId: recorderId },
      { recordedAt: recorded().recordedAt },
      { provenance: "staff-recorded" },
      { versionReference: "asset/version-1" },
    ]) {
      expect(parseRevisionRoundDeclaration({ ...round(), ...extra })).toEqual(invalidDeclaration);
    }
  });
});

describe("versioned staff-recorded allowance boundary", () => {
  it("retains explicit unknown and agreed zero as distinct declarations", () => {
    expect(parseRevisionRoundAllowance(unknownAllowance())).toEqual({
      ok: true,
      value: unknownAllowance(),
    });
    expect(parseRevisionRoundAllowance(agreed(0))).toEqual({ ok: true, value: agreed(0) });
  });

  it("never substitutes unknown for missing, denied, deleted or malformed source data", () => {
    for (const input of [
      null,
      undefined,
      [],
      {},
      recorded(),
      { ...recorded(), kind: "denied" },
      { ...recorded(), kind: "deleted" },
      { ...unknownAllowance(), availability: "denied" },
      { ...agreed(), evidenceReference: undefined },
    ]) {
      expect(parseRevisionRoundAllowance(input)).toEqual(invalidAllowance);
    }
  });

  it("requires canonical scope and native recorder identities for both variants", () => {
    const input = {
      ...agreed(),
      projectId: projectId.toUpperCase(),
      deliverableId: deliverableId.toUpperCase(),
      recordedByUserId: recorderId.toUpperCase(),
    };
    expect(parseRevisionRoundAllowance(input)).toEqual({ ok: true, value: agreed() });
    for (const allowance of [agreed(), unknownAllowance()]) {
      for (const field of ["projectId", "deliverableId", "recordedByUserId"]) {
        for (const value of ["same-name", "", null, undefined]) {
          expect(parseRevisionRoundAllowance({ ...allowance, [field]: value })).toEqual(
            invalidAllowance,
          );
        }
      }
    }
  });

  it("requires staff-recorded provenance and a known strict variant", () => {
    for (const provenance of [undefined, "client-authenticated", "signed", true]) {
      expect(parseRevisionRoundAllowance({ ...agreed(), provenance })).toEqual(invalidAllowance);
    }
    for (const kind of [undefined, null, "Agreed", "included", "exhausted"]) {
      expect(parseRevisionRoundAllowance({ ...agreed(), kind })).toEqual(invalidAllowance);
    }
    for (const extra of [
      { includedRounds: 0 },
      { agreementSource: "Terms" },
      { evidenceReference: "agreement/1" },
    ]) {
      expect(parseRevisionRoundAllowance({ ...unknownAllowance(), ...extra })).toEqual(
        invalidAllowance,
      );
    }
  });

  it("requires exact recording time while preserving source text and references", () => {
    expect(parseRevisionRoundAllowance(agreed())).toEqual({ ok: true, value: agreed() });
    for (const recordedAt of [
      undefined,
      "2026-11-01T09:30:00",
      "2026-02-30T09:30:00Z",
      "2026-11-01T06:00:00.0000000001Z",
    ]) {
      expect(parseRevisionRoundAllowance({ ...agreed(), recordedAt })).toEqual(invalidAllowance);
    }
    expect(parseRevisionRoundAllowance({ ...unknownAllowance(), recordedAt: undefined })).toEqual(
      invalidAllowance,
    );
  });

  it("requires substantive bounded agreement source and evidence, including agreed zero", () => {
    for (const field of ["agreementSource", "evidenceReference"]) {
      const input = agreed(0);
      Reflect.deleteProperty(input, field);
      expect(parseRevisionRoundAllowance(input)).toEqual(invalidAllowance);
    }
    for (const agreementSource of [
      " ",
      "\u200c",
      "Source\u0085",
      "Source\nline",
      "x".repeat(161),
    ]) {
      expect(parseRevisionRoundAllowance({ ...agreed(), agreementSource })).toEqual(
        invalidAllowance,
      );
    }
    for (const evidenceReference of [
      "",
      "javascript:alert(1)",
      "https://user:pass@example.invalid/source",
      " agreement/1",
      "r".repeat(2049),
    ]) {
      expect(parseRevisionRoundAllowance({ ...agreed(), evidenceReference })).toEqual(
        invalidAllowance,
      );
    }
  });

  it("rejects invalid limits or versions rather than defaulting to unknown", () => {
    for (const includedRounds of [-1, 1.5, "2", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseRevisionRoundAllowance({ ...agreed(), includedRounds })).toEqual(
        invalidAllowance,
      );
    }
    for (const version of [0, -1, 1.5, "2", undefined, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseRevisionRoundAllowance({ ...agreed(), version })).toEqual(invalidAllowance);
      expect(parseRevisionRoundAllowance({ ...unknownAllowance(), version })).toEqual(
        invalidAllowance,
      );
    }
  });
});

describe("strict data-only round scope", () => {
  it("rejects count inference, pooled terms, commercial actions and authority shortcuts", () => {
    for (const extra of [
      { feedbackRequestCount: 12 },
      { reviewEpoch: 8 },
      { history: [] },
      { pooledProjectRounds: 2 },
      { price: "100" },
      { charge: true },
      { budget: "1000" },
      { invoiceId: projectId },
      { approvedExtraWork: true },
      { authorized: true },
      { authenticatedClient: true },
      { signature: "claim" },
    ]) {
      expect(parseRevisionRoundDeclaration({ ...round(), ...extra })).toEqual(invalidDeclaration);
      expect(parseRevisionRoundAllowance({ ...agreed(), ...extra })).toEqual(invalidAllowance);
    }
  });
});
