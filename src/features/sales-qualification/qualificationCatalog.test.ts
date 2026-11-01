import { expect, test } from "vitest";
import { readQualificationCatalog } from "./qualificationCatalog";
import { previewQualificationDefinition } from "./qualificationPreview";

test("offers six original neutral research entries with pending rights and complete localized guidance", () => {
  const result = readQualificationCatalog();
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.map((entry) => entry.definitionKey)).toEqual([
    "buying-readiness",
    "complex-purchase-review",
    "customer-context-review",
    "discovery-conversation",
    "commercial-hypothesis",
    "mutual-working-agreement",
  ]);
  expect(result.value.map((entry) => entry.research.references[0]?.name)).toEqual([
    "BANT",
    "MEDDPICC",
    "SPICED",
    "SPIN",
    "Challenger",
    "Sandler",
  ]);
  expect(result.value.map((entry) => entry.criteria.length)).toEqual([4, 8, 5, 4, 4, 6]);
  expect(Object.isFrozen(result.value)).toBe(true);
  for (const entry of result.value) {
    expect(entry.provenance.kind).toBe("original");
    expect(entry.provenance.reviewStatus).toBe("pending");
    expect(entry.research.rightsStatus).toBe("pending");
    expect(entry.version).toBe(1);
    expect(new Set(entry.criteria.map((criterion) => criterion.key)).size).toBe(
      entry.criteria.length,
    );
    for (const locale of ["fa", "de", "en"] as const) {
      const preview = previewQualificationDefinition(entry, locale);
      expect(preview.ok).toBe(true);
      if (!preview.ok) continue;
      expect(preview.value.title).toBe(entry.title[locale]);
      expect(preview.value.criteria.map((criterion) => criterion.prompt)).toEqual(
        entry.criteria.map((criterion) => criterion.prompt[locale]),
      );
      for (const criterion of preview.value.criteria) {
        expect(criterion.label.trim().length).toBeGreaterThan(0);
        expect(criterion.description.trim().length).toBeGreaterThan(0);
        expect(criterion.prompt.trim().length).toBeGreaterThan(0);
      }
      expect(JSON.stringify(preview.value)).not.toMatch(
        /BANT|MEDDPICC|SPICED|SPIN|Challenger|Sandler|https?:/,
      );
    }
  }
  expect(readQualificationCatalog()).toEqual(result);
});
