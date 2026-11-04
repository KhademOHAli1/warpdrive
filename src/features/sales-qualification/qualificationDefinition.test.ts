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

test("rejects C1 NEXT LINE in a localized qualification title", () => {
  validDefinition();
  const source = qualificationDefinitionSource();
  source.title.de = "Kundenbedarf\u0085prüfen";
  expect(readQualificationDefinition(JSON.stringify(source))).toEqual({
    ok: false,
    error: { code: "invalid-definition", paths: [["title", "de"]] },
  });
});

const c1TextCases: {
  field: string;
  path: (string | number)[];
  change: (source: ReturnType<typeof qualificationDefinitionSource>) => void;
}[] = [
  {
    field: "localized description (U+0080)",
    path: ["description", "fa"],
    change(source) {
      source.description.fa = "بررسی\u0080نیاز";
    },
  },
  {
    field: "criterion label (U+0085)",
    path: ["criteria", 0, "label", "en"],
    change(source) {
      for (const criterion of source.criteria) criterion.label.en = "Review\u0085need";
    },
  },
  {
    field: "criterion description (U+009B)",
    path: ["criteria", 0, "description", "de"],
    change(source) {
      for (const criterion of source.criteria) criterion.description.de = "Bedarf\u009bprüfen";
    },
  },
  {
    field: "criterion prompt (U+009D)",
    path: ["criteria", 0, "prompt", "fa"],
    change(source) {
      for (const criterion of source.criteria) criterion.prompt.fa = "بررسی\u009dنیاز";
    },
  },
  {
    field: "research reference name (U+009F)",
    path: ["research", "references", 0, "name"],
    change(source) {
      for (const reference of source.research.references)
        reference.name = "Research\u009freference";
    },
  },
];

test.each(c1TextCases)(
  "rejects C1 controls in $field with the affected path",
  ({ change, path }) => {
    validDefinition();
    const source = qualificationDefinitionSource();
    change(source);
    const result = readQualificationDefinition(JSON.stringify(source));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-definition" } });
    if (!result.ok) expect(result.error.paths).toContainEqual(path);
  },
);

test.each([
  { label: "Farsi joiners", locale: "fa", text: "نیازهای مشتری را می\u200cخواهیم بررسی کنیم" },
  { label: "German combining text", locale: "de", text: "Kundenbedu\u0308rfnis pru\u0308fen" },
  { label: "emoji with a joiner", locale: "en", text: "Review needs with 👩\u200d💻 🚀" },
] as const)("preserves $label unchanged in bounded text", ({ locale, text }) => {
  validDefinition();
  const source = qualificationDefinitionSource();
  source.title[locale] = text;
  source.description[locale] = text;
  for (const criterion of source.criteria) {
    criterion.label[locale] = text;
    criterion.description[locale] = text;
    criterion.prompt[locale] = text;
  }
  for (const reference of source.research.references) reference.name = text;
  const result = readQualificationDefinition(JSON.stringify(source));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.title[locale]).toBe(text);
  expect(result.value.description[locale]).toBe(text);
  for (const criterion of result.value.criteria) {
    expect(criterion.label[locale]).toBe(text);
    expect(criterion.description[locale]).toBe(text);
    expect(criterion.prompt[locale]).toBe(text);
  }
  for (const reference of result.value.research.references) expect(reference.name).toBe(text);
  expect(result.value.provenance.reviewStatus).toBe("pending");
  expect(result.value.research.rightsStatus).toBe("pending");
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
