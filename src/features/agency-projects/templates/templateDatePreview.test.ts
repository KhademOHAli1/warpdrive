import { describe, expect, it } from "vitest";
import { previewTemplateDates } from "./templateDatePreview";
import { invalidDate, withDateManifest } from "./templateDatePreview.test-support";

const validDates = [
  { name: "lower endpoint", start: "0001-01-01", days: 0, due: "0001-01-01" },
  { name: "upper endpoint", start: "9999-12-31", days: 0, due: "9999-12-31" },
  { name: "leap day", start: "2024-02-28", days: 1, due: "2024-02-29" },
  { name: "after leap day", start: "2024-02-29", days: 1, due: "2024-03-01" },
  { name: "ordinary February", start: "2026-02-28", days: 1, due: "2026-03-01" },
  { name: "non-leap century", start: "1900-02-28", days: 1, due: "1900-03-01" },
  { name: "400-year leap century", start: "2000-02-28", days: 1, due: "2000-02-29" },
  { name: "next year", start: "2026-12-31", days: 1, due: "2027-01-01" },
  { name: "previous year", start: "2026-01-01", days: -1, due: "2025-12-31" },
  { name: "spring DST civil day", start: "2026-03-29", days: 1, due: "2026-03-30" },
  { name: "autumn DST civil day", start: "2026-10-25", days: 1, due: "2026-10-26" },
  { name: "Nowruz-adjacent civil day", start: "2027-03-20", days: 1, due: "2027-03-21" },
  // Ten years contain three leap days forward from 2020 and two backward to 2010.
  { name: "maximum positive offset", start: "2020-01-01", days: 3_650, due: "2029-12-29" },
  { name: "maximum negative offset", start: "2020-01-01", days: -3_650, due: "2010-01-03" },
];

const invalidStarts: { name: string; value: unknown }[] = [
  { name: "year zero", value: "0000-01-01" },
  { name: "signed extended year", value: "+010000-01-01" },
  { name: "impossible leap day", value: "2026-02-29" },
  { name: "impossible month day", value: "2024-04-31" },
  { name: "unpadded month", value: "2026-3-01" },
  { name: "unpadded day", value: "2026-03-1" },
  { name: "timestamp", value: "2026-03-01T00:00:00Z" },
  { name: "calendar annotation", value: "2026-03-01[u-ca=persian]" },
  { name: "localized digits", value: "۱۴۰۵-۰۱-۰۱" },
  { name: "surrounding whitespace", value: " 2026-03-01 " },
  { name: "missing start", value: undefined },
  { name: "null", value: null },
  { name: "date wrapper object", value: { date: "2026-03-01" } },
  { name: "coercible date array", value: ["2026-03-01"] },
];

describe("validated-manifest Gregorian civil-date preview", () => {
  it.each(validDates)("calculates $name without an instant", ({ start, days, due }) => {
    withDateManifest((manifest) => {
      const result = previewTemplateDates(manifest, start);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.projectStart).toBe(start);
      expect(result.value.intents.map((intent) => intent.dueDate)).toEqual([due, due, due]);
    }, [days, days, days])();
  });

  it.each(invalidStarts)("rejects $name instead of normalizing it", ({ value }) => {
    withDateManifest((manifest) => {
      expect(previewTemplateDates(manifest, value)).toEqual(invalidDate);
    })();
  });

  it.each([
    { name: "below the lower endpoint", start: "0001-01-01", days: -1 },
    { name: "above the upper endpoint", start: "9999-12-31", days: 1 },
  ])("returns one failure $name, not a partial preview", ({ start, days }) => {
    withDateManifest((manifest) => {
      const before = structuredClone(manifest);
      expect(previewTemplateDates(manifest, start)).toEqual(invalidDate);
      expect(manifest).toEqual(before);
    }, [0, days, 0])();
  });

  it(
    "retains the exact template version, all intent kinds and declared order",
    withDateManifest((manifest) => {
      const before = structuredClone(manifest);
      const result = previewTemplateDates(manifest, "2027-03-21");
      expect(result).toEqual({
        ok: true,
        value: {
          templateId: "dated_preview",
          version: 7,
          projectStart: "2027-03-21",
          intents: [
            {
              intentId: "model_review",
              dueDate: "2027-03-23",
              dueOffset: { basis: "calendar-days", anchor: "project-start", days: 2 },
            },
            {
              intentId: "brief_followup",
              dueDate: "2027-03-20",
              dueOffset: { basis: "calendar-days", anchor: "project-start", days: -1 },
            },
            {
              intentId: "model_assignment",
              dueDate: "2027-03-21",
              dueOffset: { basis: "calendar-days", anchor: "project-start", days: 0 },
            },
          ],
        },
      });
      expect(manifest).toEqual(before);
    }, [-1, 0, 2], [2, 0, 1]),
  );

  it(
    "returns an empty dated preview for a validated manifest without intents",
    withDateManifest((manifest) => {
      expect(previewTemplateDates(manifest, "2027-03-21")).toEqual({
        ok: true,
        value: {
          templateId: "dated_preview",
          version: 7,
          projectStart: "2027-03-21",
          intents: [],
        },
      });
    }, [0, 0, 0], []),
  );

  it(
    "validates the project start even when there are no intents",
    withDateManifest((manifest) => {
      expect(previewTemplateDates(manifest, "0000-01-01")).toEqual(invalidDate);
    }, [0, 0, 0], []),
  );

  it(
    "isolates returned rows and offsets from the input and future previews",
    withDateManifest((manifest) => {
      const before = structuredClone(manifest);
      const first = previewTemplateDates(manifest, "2027-03-21");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const expected = structuredClone(first.value);
      expect(first.value.intents).toHaveLength(3);
      expect(Object.isFrozen(manifest)).toBe(false);
      expect(Object.isFrozen(manifest.intents)).toBe(false);
      for (const row of first.value.intents) {
        const input = manifest.intents.find((intent) => intent.id === row.intentId);
        expect(input).toBeDefined();
        if (input === undefined) continue;
        expect(row.dueOffset).not.toBe(input.dueOffset);
        expect(Object.isFrozen(input.dueOffset)).toBe(false);
        Reflect.set(row.dueOffset, "days", 100);
      }
      Reflect.set(first.value.intents, "0", { intentId: "changed" });
      expect(manifest).toEqual(before);
      expect(previewTemplateDates(manifest, "2027-03-21")).toEqual({ ok: true, value: expected });
    }, [-1, 0, 2]),
  );
});
