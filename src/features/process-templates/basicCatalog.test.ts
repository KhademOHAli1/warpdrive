import { expect, test } from "vitest";
import { readBasicProcessTemplateCatalog } from "./basicCatalog";
import { planProcessTemplate } from "./templatePlan";

test("provides original basic and one-stage blank choices in Farsi, German and English", () => {
  const result = readBasicProcessTemplateCatalog();
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.map((manifest) => manifest.templateKey)).toEqual([
    "basic-sales",
    "blank-pipeline",
  ]);
  expect(Object.isFrozen(result.value)).toBe(true);
  expect(result.value.map((manifest) => manifest.stages.length)).toEqual([4, 1]);
  for (const manifest of result.value) {
    expect(manifest.provenance.kind).toBe("original");
    expect(manifest.fieldReferences).toEqual([]);
    expect(manifest.rules).toEqual([]);
    expect(manifest.actions).toEqual([]);
    expect(manifest.stages.every((stage) => stage.rottingDays === null)).toBe(true);
    for (const locale of ["fa", "de", "en"] as const) {
      const plan = planProcessTemplate(manifest, locale);
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      expect(plan.value.pipeline.name).toBe(manifest.pipeline.name[locale]);
      expect(plan.value.installation).toBe("unavailable");
      expect(plan.value.stages.every((stage) => stage.name.length > 0)).toBe(true);
    }
  }
  expect(readBasicProcessTemplateCatalog()).toEqual(result);
});
