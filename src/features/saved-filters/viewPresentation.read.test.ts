import { describe, expect, test } from "vitest";
import type { SavedFilterTargetEntity } from "./schemas";
import { storedViewDefinition } from "./storedViewDefinition";
import { decodeSavedViewDefinition, encodeSavedViewDefinition } from "./viewDefinitionVersion";

interface Fixture {
  targetEntity: Exclude<SavedFilterTargetEntity, "deal">;
  conditionField: string;
  pinned: string;
  columns: string[];
  sortFields: string[];
  defaultSort: string;
  foreignColumn: string;
  foreignSort: string;
}
const fixtures: Fixture[] = [
  {
    targetEntity: "person",
    conditionField: "primaryEmail",
    pinned: "name",
    columns: ["name", "phone", "org", "closedDeals", "email"],
    sortFields: ["name", "primaryEmail"],
    defaultSort: "primaryEmail",
    foreignColumn: "owner",
    foreignSort: "ownerName",
  },
  {
    targetEntity: "organization",
    conditionField: "industry",
    pinned: "name",
    columns: ["name", "peopleCount", "address", "openDeals", "closedDeals"],
    sortFields: ["name"],
    defaultSort: "name",
    foreignColumn: "org",
    foreignSort: "primaryEmail",
  },
  {
    targetEntity: "lead",
    conditionField: "sourceOrigin",
    pinned: "title",
    columns: ["title", "owner", "value", "createdAt", "nextActivity", "labels", "sourceOrigin"],
    sortFields: [
      "title",
      "nextActivityAt",
      "label",
      "sourceOrigin",
      "value",
      "createdAt",
      "ownerName",
    ],
    defaultSort: "ownerName",
    foreignColumn: "name",
    foreignSort: "name",
  },
];

function definitionFor(fixture: Fixture) {
  return {
    combinator: "or",
    conditions: [{ field: fixture.conditionField, op: "contains", value: "  ایران / Straße  " }],
  };
}
function presentationFor(fixture: Fixture) {
  return {
    version: 1,
    columns: [...fixture.columns],
    sort: { field: fixture.defaultSort, dir: "desc" },
  };
}
function envelopeFor(fixture: Fixture, presentation?: unknown) {
  return {
    version: 1,
    targetEntity: fixture.targetEntity,
    definition: definitionFor(fixture),
    ...(presentation === undefined ? {} : { presentation }),
  };
}
function invalidPresentations(fixture: Fixture): Array<[string, unknown]> {
  const base = presentationFor(fixture);
  return [
    ["unknown column", { ...base, columns: [fixture.pinned, "private-column"] }],
    ["duplicate column", { ...base, columns: [fixture.pinned, fixture.pinned] }],
    ["custom column", { ...base, columns: [fixture.pinned, "cf:region"] }],
    ["cross-entity column", { ...base, columns: [fixture.pinned, fixture.foreignColumn] }],
    ["missing pinned column", { ...base, columns: fixture.columns.slice(1) }],
    [
      "pinned column not first",
      { ...base, columns: [...fixture.columns.slice(1), fixture.pinned] },
    ],
    ["empty columns", { ...base, columns: [] }],
    ["unknown sort", { ...base, sort: { field: "private-sort", dir: "asc" } }],
    ["cross-entity sort", { ...base, sort: { field: fixture.foreignSort, dir: "asc" } }],
    ["custom sort", { ...base, sort: { field: "cf:region", dir: "asc" } }],
    ["invalid direction", { ...base, sort: { field: fixture.defaultSort, dir: "sideways" } }],
    ["unknown sort key", { ...base, sort: { ...base.sort, nulls: "first" } }],
    ["unknown presentation key", { ...base, locale: "fa" }],
    ["unsupported version", { ...base, version: 2 }],
    ["missing sort", { version: 1, columns: [...fixture.columns] }],
    ["missing columns", { version: 1, sort: base.sort }],
  ];
}

describe.each(fixtures)("$targetEntity presentation reads", (fixture) => {
  test("decodes and encodes the full envelope without dropping columns, order, sort or text", () => {
    const raw = envelopeFor(fixture, presentationFor(fixture));
    expect(decodeSavedViewDefinition(fixture.targetEntity, raw)).toEqual({
      ok: true,
      value: { source: "v1", envelope: raw },
    });
    expect(encodeSavedViewDefinition(fixture.targetEntity, raw)).toEqual({ ok: true, value: raw });
    expect(raw.definition.conditions[0]?.value).toBe("  ایران / Straße  ");
  });

  test.each(fixture.sortFields.flatMap((field) => ["asc", "desc"].map((dir) => ({ field, dir }))))(
    "accepts native presentation sort %j",
    (sort) => {
      const raw = envelopeFor(fixture, { ...presentationFor(fixture), sort });
      expect(decodeSavedViewDefinition(fixture.targetEntity, raw)).toEqual({
        ok: true,
        value: { source: "v1", envelope: raw },
      });
    },
  );

  test("carries validated presentation into the available safe DTO", () => {
    const presentation = presentationFor(fixture);
    const raw = envelopeFor(fixture, presentation);
    expect(storedViewDefinition(fixture.targetEntity, raw)).toEqual({
      availability: "available",
      definition: raw.definition,
      presentation,
    });
  });

  test.each([undefined, { version: 1 }])(
    "keeps absent or reserved presentation %j on the personal baseline",
    (presentation) => {
      const raw = envelopeFor(fixture, presentation);
      expect(decodeSavedViewDefinition(fixture.targetEntity, raw)).toEqual({
        ok: true,
        value: { source: "v1", envelope: raw },
      });
      expect(storedViewDefinition(fixture.targetEntity, raw)).toEqual({
        availability: "available",
        definition: raw.definition,
      });
      expect(storedViewDefinition(fixture.targetEntity, raw.definition)).toEqual({
        availability: "available",
        definition: raw.definition,
      });
    },
  );

  test.each(invalidPresentations(fixture))(
    "retains raw recovery and emits an unavailable safe DTO for %s",
    (_label, presentation) => {
      const raw = envelopeFor(fixture, presentation);
      const decoded = decodeSavedViewDefinition(fixture.targetEntity, raw);
      expect(decoded).toMatchObject({
        ok: false,
        error: {
          kind: "unsupported",
          code: "unsupported-presentation",
          recovery: "retain-original",
        },
      });
      if (!decoded.ok) expect(decoded.error.raw).toBe(raw);
      expect(decoded).not.toHaveProperty("value");
      const dto = storedViewDefinition(fixture.targetEntity, raw);
      expect(dto).toEqual({
        availability: "unavailable",
        definition: null,
        problem: { kind: "unsupported", code: "unsupported-presentation" },
      });
      expect(JSON.stringify(dto)).not.toContain("ایران");
      expect(dto).not.toHaveProperty("raw");
      expect(dto).not.toHaveProperty("presentation");
    },
  );
});

test("keeps full deal presentation unavailable while its native resolver is unsupported", () => {
  const raw = {
    version: 1,
    targetEntity: "deal",
    definition: { combinator: "and", conditions: [] },
    presentation: {
      version: 1,
      columns: ["title", "value"],
      sort: { field: "value", dir: "desc" },
    },
  };
  const decoded = decodeSavedViewDefinition("deal", raw);
  expect(decoded).toMatchObject({
    ok: false,
    error: { code: "unsupported-presentation", recovery: "retain-original" },
  });
  if (!decoded.ok) expect(decoded.error.raw).toBe(raw);
  expect(storedViewDefinition("deal", raw)).toEqual({
    availability: "unavailable",
    definition: null,
    problem: { kind: "unsupported", code: "unsupported-presentation" },
  });
});
