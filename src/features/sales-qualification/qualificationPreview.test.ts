import { expect, test } from "vitest";
import { readQualificationDefinition } from "./qualificationDefinition";
import { qualificationDefinitionSource } from "./qualificationFixtures";
import { previewQualificationDefinition } from "./qualificationPreview";

test("previews stable criterion identity in the caller locale without granting effects", () => {
  const source = qualificationDefinitionSource();
  const parsed = readQualificationDefinition(JSON.stringify(source));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  for (const locale of ["fa", "de", "en"] as const) {
    const result = previewQualificationDefinition(parsed.value, locale);
    expect(result.ok).toBe(true);
    if (!result.ok) continue;
    expect(result.value).toMatchObject({
      kind: "preview-only",
      locale,
      nativeIds: "unallocated",
      rightsStatus: "pending",
      definition: { key: "buying-readiness", version: 1, schemaVersion: 1 },
      capabilities: {
        installation: "unavailable",
        persistedSelection: "unavailable",
        evidenceWrite: "unavailable",
        scoring: "unavailable",
        stagePolicy: "unavailable",
        effects: "unavailable",
      },
      title: source.title[locale],
      description: source.description[locale],
      criteria: [
        {
          identity: "buying-readiness@1/criteria/customer-need",
          key: "customer-need",
          label: source.criteria[0]?.label[locale],
          description: source.criteria[0]?.description[locale],
          prompt: source.criteria[0]?.prompt[locale],
        },
      ],
    });
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.definition)).toBe(true);
    expect(Object.isFrozen(result.value.capabilities)).toBe(true);
    expect(Object.isFrozen(result.value.criteria)).toBe(true);
    expect(Object.isFrozen(result.value.criteria[0])).toBe(true);
    expect(previewQualificationDefinition(parsed.value, locale)).toEqual(result);
  }
  expect(previewQualificationDefinition(parsed.value, "fr")).toEqual({
    ok: false,
    error: { code: "unsupported-locale" },
  });
  const next = readQualificationDefinition(JSON.stringify({ ...source, version: 2 }));
  expect(next.ok).toBe(true);
  if (!next.ok) return;
  const changed = previewQualificationDefinition(next.value, "en");
  expect(changed.ok).toBe(true);
  if (changed.ok)
    expect(changed.value.criteria[0]?.identity).toBe("buying-readiness@2/criteria/customer-need");
});
