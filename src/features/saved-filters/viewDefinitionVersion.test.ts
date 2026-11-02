import { describe, expect, it } from "vitest";
import { parseSavedFilterDefinitionFor } from "./parseDefinition";
import type { SavedFilterTargetEntity } from "./schemas";
import { decodeSavedViewDefinition, encodeSavedViewDefinition } from "./viewDefinitionVersion";

const cases: Array<[SavedFilterTargetEntity, string, string]> = [
  ["deal", "title", "فرصت فروش آلمان | Müller & Söhne"],
  ["person", "primaryEmail", "Ali.Example+Tehran@example.test"],
  ["organization", "industry", "نرم‌افزار | Öffentliche Verwaltung"],
  ["lead", "sourceOrigin", "معرفی همکار | Empfehlung"],
];

describe("compatible saved-view definition decoding", () => {
  it.each(cases)(
    "retains the %s legacy entity validator and authored text",
    (target, field, text) => {
      const raw = { conditions: [{ field, op: "contains", value: text }] };
      const result = decodeSavedViewDefinition(target, raw);
      expect(result).toEqual({
        ok: true,
        value: {
          source: "legacy",
          envelope: {
            version: 1,
            targetEntity: target,
            definition: parseSavedFilterDefinitionFor(target, raw),
          },
        },
      });
      expect(raw).not.toHaveProperty("combinator");
    },
  );

  it("keeps seeded deal defaults, rotting narrowing, combinator and legacy sort", () => {
    const raw = { rotting: true, sort: { field: "value", dir: "desc" } };
    const result = decodeSavedViewDefinition("deal", raw);
    expect(result).toMatchObject({
      ok: true,
      value: {
        envelope: {
          definition: {
            combinator: "and",
            conditions: [],
            rotting: true,
            sort: raw.sort,
          },
        },
      },
    });
    expect(decodeSavedViewDefinition("deal", {})).toMatchObject({ ok: true });
  });

  it("keeps explicit OR, exact numeric strings, relative dates and valueless conditions", () => {
    const raw = {
      combinator: "or",
      conditions: [
        { field: "value", op: "gt", value: "001234560.10" },
        { field: "nextActivityAt", op: "eq", value: "this_week" },
        { field: "labels", op: "isEmpty" },
      ],
    };
    const result = decodeSavedViewDefinition("deal", raw);
    expect(result).toMatchObject({ ok: true, value: { envelope: { definition: raw } } });
  });

  it("returns a recoverable error and original payload rather than an empty widened query", () => {
    const raw = {
      combinator: "and",
      conditions: [
        { field: "ownerId", op: "eq", value: "restricted-owner" },
        { field: "futureField", op: "eq", value: "private" },
      ],
    };
    const result = decodeSavedViewDefinition("deal", raw);
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "unsupported",
        code: "unsupported-field",
        recovery: "retain-original",
      },
    });
    if (result.ok) throw new Error("unsupported filter must not execute");
    expect(result.error.raw).toBe(raw);
    expect(result).not.toHaveProperty("value");
  });

  it("distinguishes unsupported operators from invalid known field/operator pairings", () => {
    expect(
      decodeSavedViewDefinition("deal", {
        conditions: [{ field: "title", op: "fuzzyFuture", value: "x" }],
      }),
    ).toMatchObject({ ok: false, error: { kind: "unsupported", code: "unsupported-operator" } });
    expect(
      decodeSavedViewDefinition("deal", {
        conditions: [{ field: "value", op: "contains", value: "5" }],
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalid", code: "invalid-definition" } });
  });

  it.each([
    null,
    42,
    [],
    { conditions: "nope" },
    { conditions: [{ field: "title", op: "contains" }] },
  ])("rejects malformed data without substituting a usable filter", (raw) => {
    expect(decodeSavedViewDefinition("deal", raw)).toMatchObject({
      ok: false,
      error: {
        kind: "invalid",
        code: "invalid-definition",
        raw,
      },
    });
  });

  it("uses the row's entity ceiling and rejects foreign fields or stripped semantics", () => {
    expect(
      decodeSavedViewDefinition("person", {
        conditions: [{ field: "stageId", op: "eq", value: "stage" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "unsupported-field" } });
    expect(decodeSavedViewDefinition("person", { conditions: [], rotting: true })).toMatchObject({
      ok: false,
      error: { code: "unsupported-keys" },
    });
  });

  it.each([
    { conditions: [], ownerId: "must-not-be-dropped" },
    { conditions: [{ field: "title", op: "contains", value: "x", negate: true }] },
    { conditions: [], sort: { field: "title", dir: "asc", nulls: "first" } },
  ])("rejects unknown nested or top-level keys instead of silently dropping them", (raw) => {
    expect(decodeSavedViewDefinition("deal", raw)).toMatchObject({
      ok: false,
      error: {
        kind: "unsupported",
        code: "unsupported-keys",
        raw,
      },
    });
  });
});

describe("versioned saved-view envelopes", () => {
  it("decodes an explicit V1 envelope and round-trips it without rewriting text or legacy sort", () => {
    const raw = {
      version: 1,
      targetEntity: "deal",
      definition: {
        combinator: "and",
        conditions: [{ field: "title", op: "contains", value: "  پروژهٔ ایران / Straße  " }],
        sort: { field: "value", dir: "desc" },
      },
    };
    const result = decodeSavedViewDefinition("deal", raw);
    expect(result).toEqual({ ok: true, value: { source: "v1", envelope: raw } });
    expect(encodeSavedViewDefinition("deal", raw)).toEqual({ ok: true, value: raw });
  });

  it("upgrades only the representation of a valid bare definition", () => {
    const raw = { conditions: [{ field: "labels", op: "eq", value: ["گرم", "Überprüfung"] }] };
    const encoded = encodeSavedViewDefinition("deal", raw);
    expect(encoded).toMatchObject({
      ok: true,
      value: {
        version: 1,
        targetEntity: "deal",
        definition: { combinator: "and", conditions: raw.conditions },
      },
    });
    expect(raw).not.toHaveProperty("version");
    if (!encoded.ok) throw new Error("expected valid encoded view");
    expect(decodeSavedViewDefinition("deal", encoded.value)).toEqual({
      ok: true,
      value: { source: "v1", envelope: encoded.value },
    });
  });

  it("keeps unsupported versions for recovery and distinguishes malformed versions", () => {
    expect(decodeSavedViewDefinition("deal", { version: 9, arbitrary: "future" })).toMatchObject({
      ok: false,
      error: { kind: "unsupported", code: "unsupported-version" },
    });
    expect(
      decodeSavedViewDefinition("deal", { version: "1", targetEntity: "deal", definition: {} }),
    ).toMatchObject({ ok: false, error: { kind: "invalid", code: "invalid-envelope" } });
  });

  it("requires matching entity and a real definition, without treating a missing body as all records", () => {
    expect(
      decodeSavedViewDefinition("deal", {
        version: 1,
        targetEntity: "person",
        definition: { conditions: [] },
      }),
    ).toMatchObject({ ok: false, error: { code: "entity-mismatch" } });
    expect(decodeSavedViewDefinition("deal", { version: 1, targetEntity: "deal" })).toMatchObject({
      ok: false,
      error: { code: "invalid-envelope" },
    });
  });

  it("reserves presentation separately and rejects columns/sort until their resolvers exist", () => {
    const base = { version: 1, targetEntity: "deal", definition: { conditions: [] } };
    expect(
      decodeSavedViewDefinition("deal", { ...base, presentation: { version: 1 } }),
    ).toMatchObject({ ok: true });
    for (const presentation of [
      { version: 1, columns: ["private-field"] },
      { version: 1, sort: { field: "value", dir: "desc" } },
      { version: 2 },
    ]) {
      expect(decodeSavedViewDefinition("deal", { ...base, presentation })).toMatchObject({
        ok: false,
        error: { kind: "unsupported", code: "unsupported-presentation" },
      });
    }
  });

  it("does not accept sharing, membership or locale as executable view-envelope data", () => {
    for (const extra of [{ isShared: true }, { workspaceId: "other" }, { locale: "de" }]) {
      expect(
        decodeSavedViewDefinition("deal", {
          version: 1,
          targetEntity: "deal",
          definition: { conditions: [] },
          ...extra,
        }),
      ).toMatchObject({
        ok: false,
        error: {
          code: "unsupported-keys",
        },
      });
    }
  });
});
