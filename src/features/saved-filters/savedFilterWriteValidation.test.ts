import { describe, expect, test } from "vitest";
import {
  type SavedFilterTargetEntity,
  saveFilterInput,
  updateSavedFilterInputFor,
} from "./schemas";

const entities = [
  ["deal", "title"],
  ["person", "primaryEmail"],
  ["organization", "industry"],
  ["lead", "sourceOrigin"],
] as const;
const operations = ["create", "definition update"] as const;
type Operation = (typeof operations)[number];

function parseWrite(
  targetEntity: SavedFilterTargetEntity,
  definition: unknown,
  operation: Operation,
) {
  return operation === "create"
    ? saveFilterInput.safeParse({ name: "Acme only", targetEntity, definition })
    : updateSavedFilterInputFor(targetEntity).safeParse({ definition });
}

describe.each(entities)("%s saved-definition write boundary", (targetEntity, field) => {
  const condition = { field, op: "contains", value: "Acme" };
  const definition = { conditions: [condition] };

  test.each(operations)("retains a nonempty native bare definition on %s", (operation) => {
    const parsed = parseWrite(targetEntity, definition, operation);
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.definition).toEqual({ combinator: "and", conditions: [condition] });
    expect(definition).toEqual({ conditions: [condition] });
  });

  test.each(operations)("rejects supported and future envelopes on %s", (operation) => {
    for (const version of [1, 99]) {
      const envelope = { version, targetEntity, definition };
      // The deal schema previously defaulted absent top-level conditions to an empty filter.
      expect(parseWrite(targetEntity, envelope, operation).success).toBe(false);
      // Other entities must also reject an envelope carrying plausible native keys alongside it.
      expect(parseWrite(targetEntity, { ...definition, ...envelope }, operation).success).toBe(
        false,
      );
    }
  });

  test.each(operations)("rejects unknown definition keys on %s", (operation) => {
    expect(
      parseWrite(targetEntity, { ...definition, futureNarrowing: true }, operation).success,
    ).toBe(false);
    expect(
      parseWrite(
        targetEntity,
        { ...definition, presentation: { version: 1, columns: [field] } },
        operation,
      ).success,
    ).toBe(false);
  });

  test.each(operations)("rejects unknown nested condition keys on %s", (operation) => {
    const futureCondition = { ...condition, futureScope: "managed-team" };
    expect(parseWrite(targetEntity, { conditions: [futureCondition] }, operation).success).toBe(
      false,
    );
    expect(futureCondition.futureScope).toBe("managed-team");
  });

  test.each(operations)("retains native condition refinements on %s", (operation) => {
    expect(
      parseWrite(targetEntity, { conditions: [{ field, op: "contains" }] }, operation).success,
    ).toBe(false);
    expect(
      parseWrite(targetEntity, { conditions: [{ field, op: "gt", value: "Acme" }] }, operation)
        .success,
    ).toBe(false);
    expect(
      parseWrite(
        targetEntity,
        { conditions: [{ field: "labels", op: "eq", value: [] }] },
        operation,
      ).success,
    ).toBe(false);
  });

  test("permits metadata-only updates without creating or replacing a definition", () => {
    const patch = { name: "Renamed view", isShared: false };
    expect(updateSavedFilterInputFor(targetEntity).parse(patch)).toEqual(patch);
    expect(updateSavedFilterInputFor(targetEntity).parse({})).toEqual({});
  });
});

test.each(operations)("retains deal rotting and native sort on %s", (operation) => {
  const definition = {
    conditions: [{ field: "status", op: "eq", value: "open" }],
    rotting: true,
    sort: { field: "value", dir: "asc" },
  };
  const parsed = parseWrite("deal", definition, operation);
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data.definition).toEqual({ combinator: "and", ...definition });
});

test.each(operations)("rejects unknown nested deal sort keys on %s", (operation) => {
  expect(
    parseWrite(
      "deal",
      {
        conditions: [{ field: "status", op: "eq", value: "open" }],
        sort: { field: "value", dir: "asc", nulls: "first" },
      },
      operation,
    ).success,
  ).toBe(false);
});

test("keeps the historical empty deal definition default available to native bare writes", () => {
  expect(
    saveFilterInput.parse({ name: "All deals", targetEntity: "deal", definition: {} }),
  ).toMatchObject({ definition: { combinator: "and", conditions: [] } });
});
