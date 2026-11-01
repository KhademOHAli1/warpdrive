import { expect, test } from "vitest";
import { readQualificationDefinition } from "./qualificationDefinition";
import { qualificationDefinitionSource } from "./qualificationFixtures";

function validDefinition() {
  const result = readQualificationDefinition(JSON.stringify(qualificationDefinitionSource()));
  expect(result.ok).toBe(true);
  return result;
}

test("parses versioned definitions into deeply immutable data without native identities", () => {
  const result = validDefinition();
  if (!result.ok) return;
  expect(result.value.definitionKey).toBe("buying-readiness");
  expect(result.value.version).toBe(1);
  for (const value of [
    result.value,
    result.value.title,
    result.value.provenance,
    result.value.research,
    result.value.research.references,
    result.value.research.references[0],
    result.value.criteria,
    result.value.criteria[0],
    result.value.criteria[0]?.prompt,
  ])
    expect(Object.isFrozen(value)).toBe(true);
  expect(result.value).not.toHaveProperty("pipelineId");
  expect(result.value).not.toHaveProperty("fieldId");
});

test("rejects literal and decoded duplicate keys at any object depth", () => {
  validDefinition();
  const source = JSON.stringify(qualificationDefinitionSource());
  for (const duplicate of [
    source.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    source.replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1'),
    source.replace('"en":"Review need"', '"en":"Review need","\\u0065n":"other"'),
  ])
    expect(readQualificationDefinition(duplicate)).toEqual({
      ok: false,
      error: { code: "duplicate-key", paths: [] },
    });
});

test("rejects malformed, unsupported, and byte-oversized definitions", () => {
  validDefinition();
  expect(readQualificationDefinition(null).ok).toBe(false);
  expect(readQualificationDefinition("{").ok).toBe(false);
  for (const schemaVersion of [0, 2, "1", null]) {
    const source = { ...qualificationDefinitionSource(), schemaVersion };
    expect(readQualificationDefinition(JSON.stringify(source))).toEqual({
      ok: false,
      error: { code: "unsupported-version", paths: [["schemaVersion"]] },
    });
  }
  expect(readQualificationDefinition("آ".repeat(32_769))).toEqual({
    ok: false,
    error: { code: "definition-too-large", paths: [] },
  });
});

test("returns an invalid-definition result for malformed research URLs without throwing", () => {
  validDefinition();
  const source = qualificationDefinitionSource();
  source.research.references[0] = { name: "BANT", url: "not-a-url", accessedOn: "2026-11-01" };
  const read = () => readQualificationDefinition(JSON.stringify(source));
  expect(read).not.toThrow();
  expect(read()).toMatchObject({ ok: false, error: { code: "invalid-definition" } });
});

test("rejects unsupported payloads, prototype keys, invalid content, and ambiguous criteria", () => {
  validDefinition();
  const base = qualificationDefinitionSource();
  const criterion = base.criteria[0];
  const invalid = [
    { ...base, fieldReferences: [] },
    { ...base, rules: [] },
    { ...base, actions: [] },
    { ...base, pipelineId: "native" },
    { ...base, stages: [] },
    { ...base, evidence: [] },
    { ...base, definitionKey: "constructor" },
    { ...base, definitionKey: "__proto__" },
    { ...base, version: 0 },
    { ...base, version: 1.5 },
    { ...base, version: 2_147_483_648 },
    { ...base, title: { ...base.title, en: " " } },
    { ...base, title: { ...base.title, en: "x".repeat(256) } },
    { ...base, title: { ...base.title, en: "unsafe\u0000" } },
    { ...base, title: { en: "Only English" } },
    { ...base, criteria: [] },
    { ...base, criteria: [criterion, criterion] },
    {
      ...base,
      criteria: Array.from({ length: 17 }, (_, index) => ({ ...criterion, key: `c-${index}` })),
    },
    { ...base, criteria: [{ ...criterion, key: "prototype" }] },
    { ...base, criteria: [{ ...criterion, prompt: { ...base.title, en: "x".repeat(1001) } }] },
    { ...base, provenance: { ...base.provenance, kind: "licensed" } },
    { ...base, research: { ...base.research, rightsStatus: "cleared" } },
    { ...base, research: { ...base.research, references: [] } },
    {
      ...base,
      research: {
        ...base.research,
        references: [{ name: "BANT", url: "javascript:run()", accessedOn: "2026-11-01" }],
      },
    },
    {
      ...base,
      research: {
        ...base.research,
        references: [{ name: "BANT", url: "https://example.org", accessedOn: "2026-02-30" }],
      },
    },
  ];
  for (const value of invalid)
    expect(readQualificationDefinition(JSON.stringify(value)).ok).toBe(false);
  const json = JSON.stringify(base);
  for (const key of ["__proto__", "prototype", "constructor"]) {
    expect(
      readQualificationDefinition(
        json.replace('"schemaVersion":1', `"${key}":{},"schemaVersion":1`),
      ).ok,
    ).toBe(false);
    expect(
      readQualificationDefinition(
        json.replace('"en":"Review need"', `"${key}":{},"en":"Review need"`),
      ).ok,
    ).toBe(false);
  }
});
