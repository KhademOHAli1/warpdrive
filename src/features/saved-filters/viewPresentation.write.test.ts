import { describe, expect, test } from "vitest";
import {
  type SavedFilterTargetEntity,
  saveFilterInput,
  updateSavedFilterInputFor,
} from "./schemas";

interface Fixture {
  targetEntity: Exclude<SavedFilterTargetEntity, "deal">;
  conditionField: string;
  pinned: string;
  columns: string[];
  sortField: string;
  foreignColumn: string;
  foreignSort: string;
}
const fixtures: Fixture[] = [
  {
    targetEntity: "person",
    conditionField: "primaryEmail",
    pinned: "name",
    columns: ["name", "phone", "org", "email", "closedDeals"],
    sortField: "primaryEmail",
    foreignColumn: "owner",
    foreignSort: "ownerName",
  },
  {
    targetEntity: "organization",
    conditionField: "industry",
    pinned: "name",
    columns: ["name", "peopleCount", "openDeals", "closedDeals", "address"],
    sortField: "name",
    foreignColumn: "org",
    foreignSort: "primaryEmail",
  },
  {
    targetEntity: "lead",
    conditionField: "sourceOrigin",
    pinned: "title",
    columns: ["title", "value", "owner", "labels", "sourceOrigin", "createdAt", "nextActivity"],
    sortField: "ownerName",
    foreignColumn: "name",
    foreignSort: "name",
  },
];
const operations = ["create", "definition update"] as const;
type Operation = (typeof operations)[number];

function write(targetEntity: SavedFilterTargetEntity, definition: unknown, operation: Operation) {
  return operation === "create"
    ? saveFilterInput.safeParse({
        name: "  ایران / Straße  ",
        targetEntity,
        definition,
        isShared: false,
      })
    : updateSavedFilterInputFor(targetEntity).safeParse({ definition });
}
function bareFor(fixture: Fixture) {
  return {
    combinator: "or",
    conditions: [{ field: fixture.conditionField, op: "contains", value: "  ایران / Straße  " }],
  };
}
function envelopeFor(fixture: Fixture) {
  return {
    version: 1,
    targetEntity: fixture.targetEntity,
    definition: bareFor(fixture),
    presentation: {
      version: 1,
      columns: [...fixture.columns],
      sort: { field: fixture.sortField, dir: "desc" },
    },
  };
}
function malformedEnvelopes(fixture: Fixture): Array<[string, unknown]> {
  const raw = envelopeFor(fixture);
  const presentation = raw.presentation;
  const withPresentation = (patch: Record<string, unknown>) => ({
    ...raw,
    presentation: { ...presentation, ...patch },
  });
  const withSort = (patch: Record<string, unknown>) =>
    withPresentation({ sort: { ...presentation.sort, ...patch } });
  const withCondition = (condition: Record<string, unknown>) => ({
    ...raw,
    definition: { conditions: [condition] },
  });
  return [
    ["future envelope", { ...raw, version: 99 }],
    ["non-numeric envelope version", { ...raw, version: "1" }],
    ["mismatched entity", { ...raw, targetEntity: "deal" }],
    ["missing definition", { ...raw, definition: undefined }],
    ["unknown envelope keys", { ...raw, actorId: "other", workspaceId: "other" }],
    ["native keys beside envelope", { ...raw, conditions: raw.definition.conditions }],
    ["unknown definition key", { ...raw, definition: { ...raw.definition, futureScope: true } }],
    [
      "unknown nested condition key",
      withCondition({ field: fixture.conditionField, op: "contains", value: "x", negate: true }),
    ],
    ["foreign condition", withCondition({ field: "stageId", op: "eq", value: "stage" })],
    ["unknown column", withPresentation({ columns: [fixture.pinned, "private-column"] })],
    ["duplicate column", withPresentation({ columns: [fixture.pinned, fixture.pinned] })],
    ["custom column", withPresentation({ columns: [fixture.pinned, "cf:region"] })],
    ["foreign column", withPresentation({ columns: [fixture.pinned, fixture.foreignColumn] })],
    ["missing pinned column", withPresentation({ columns: fixture.columns.slice(1) })],
    [
      "pinned column not first",
      withPresentation({ columns: [...fixture.columns.slice(1), fixture.pinned] }),
    ],
    ["empty columns", withPresentation({ columns: [] })],
    ["unknown sort", withSort({ field: "private-sort" })],
    ["custom sort", withSort({ field: "cf:region", dir: "asc" })],
    ["foreign sort", withSort({ field: fixture.foreignSort, dir: "asc" })],
    ["invalid direction", withSort({ dir: "sideways" })],
    ["unknown sort key", withSort({ nulls: "first" })],
    ["future presentation", withPresentation({ version: 2 })],
    ["unknown presentation key", withPresentation({ locale: "fa" })],
    [
      "partial presentation",
      { ...raw, presentation: { version: 1, columns: [...fixture.columns] } },
    ],
    ["missing columns", { ...raw, presentation: { version: 1, sort: presentation.sort } }],
  ];
}

describe.each(fixtures)("$targetEntity envelope writes", (fixture) => {
  test.each(operations)("accepts the complete validated envelope intact on %s", (operation) => {
    const raw = envelopeFor(fixture);
    const original = structuredClone(raw);
    const parsed = write(fixture.targetEntity, raw, operation);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.definition).toEqual(original);
    expect(raw).toEqual(original);
  });

  test.each(operations)("accepts absent and reserved baseline presentation on %s", (operation) => {
    const envelope = {
      version: 1,
      targetEntity: fixture.targetEntity,
      definition: bareFor(fixture),
    };
    for (const raw of [envelope, { ...envelope, presentation: { version: 1 } }]) {
      const parsed = write(fixture.targetEntity, raw, operation);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.definition).toEqual(raw);
    }
  });

  test.each(operations)("retains strict native bare definitions on %s", (operation) => {
    const bare = bareFor(fixture);
    const parsed = write(fixture.targetEntity, bare, operation);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.definition).toEqual(bare);
    expect(write(fixture.targetEntity, { ...bare, futureScope: true }, operation).success).toBe(
      false,
    );
    expect(
      write(
        fixture.targetEntity,
        {
          conditions: [{ field: fixture.conditionField, op: "contains", value: "x", negate: true }],
        },
        operation,
      ).success,
    ).toBe(false);
  });

  test.each(operations)("rejects malformed envelopes without weakening them on %s", (operation) => {
    for (const [label, raw] of malformedEnvelopes(fixture)) {
      const original = structuredClone(raw);
      expect(write(fixture.targetEntity, raw, operation).success, label).toBe(false);
      expect(raw).toEqual(original);
    }
  });

  test("keeps metadata-only updates from creating or replacing the stored definition", () => {
    const patch = { name: "Renamed view", isShared: false };
    expect(updateSavedFilterInputFor(fixture.targetEntity).parse(patch)).toEqual(patch);
    expect(updateSavedFilterInputFor(fixture.targetEntity).parse({})).toEqual({});
  });
});

test.each(operations)("rejects full deal presentation on %s", (operation) => {
  const raw = {
    version: 1,
    targetEntity: "deal",
    definition: { combinator: "and", conditions: [] },
    presentation: { version: 1, columns: ["title", "value"], sort: { field: "value", dir: "asc" } },
  };
  expect(write("deal", raw, operation).success).toBe(false);
});
