import { expect, test } from "vitest";
import { templateFixture } from "./templateFixtures";
import { readProcessTemplateManifest } from "./templateManifest";

test("reads a versioned stage-only manifest without rewriting authored labels", () => {
  const input = templateFixture();
  const result = readProcessTemplateManifest(JSON.stringify(input));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toEqual(input);
  expect(result.value.pipeline.name.fa).toBe("فروش / DACH");
});

test.each([
  ["schema version", (m: ReturnType<typeof templateFixture>) => ({ ...m, schemaVersion: 2 })],
  ["content version", (m: ReturnType<typeof templateFixture>) => ({ ...m, version: 0 })],
  ["unstable key", (m: ReturnType<typeof templateFixture>) => ({ ...m, templateKey: "Sales / 1" })],
  [
    "missing Farsi",
    (m: ReturnType<typeof templateFixture>) => ({ ...m, title: { en: "Sales", de: "Vertrieb" } }),
  ],
  [
    "unsupported locale",
    (m: ReturnType<typeof templateFixture>) => ({ ...m, title: { ...m.title, fr: "Ventes" } }),
  ],
  ["empty stages", (m: ReturnType<typeof templateFixture>) => ({ ...m, stages: [] })],
  [
    "duplicate stage keys",
    (m: ReturnType<typeof templateFixture>) => ({ ...m, stages: [m.stages[0], m.stages[0]] }),
  ],
  [
    "too many stages",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      stages: Array.from({ length: 33 }, (_, i) => ({ ...m.stages[0], key: `stage-${i}` })),
    }),
  ],
  [
    "long stage name",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      stages: [{ ...m.stages[0], name: { ...m.title, fa: "ن".repeat(256) } }],
    }),
  ],
  [
    "empty pipeline name",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      pipeline: { name: { ...m.title, fa: "   " } },
    }),
  ],
  [
    "negative aging",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      stages: [{ ...m.stages[0], rottingDays: -1 }],
    }),
  ],
  [
    "fractional aging",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      stages: [{ ...m.stages[0], rottingDays: 1.5 }],
    }),
  ],
  [
    "overflowing aging",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      stages: [{ ...m.stages[0], rottingDays: 2147483648 }],
    }),
  ],
  [
    "native stage id",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      stages: [{ ...m.stages[0], id: "8b170b24-a9b2-46cc-a5ab-46ae8e4d3267" }],
    }),
  ],
  [
    "stage status",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      stages: [{ ...m.stages[0], status: "won" }],
    }),
  ],
  [
    "scope grant",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      pipeline: { ...m.pipeline, visibilityGroupId: null },
    }),
  ],
  [
    "field reference",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      fieldReferences: [{ entity: "deal", field: "value" }],
    }),
  ],
  [
    "stage rule",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      rules: [{ operator: "required", field: "value" }],
    }),
  ],
  [
    "provider command",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      actions: [{ provider: "gmail", command: "send" }],
    }),
  ],
  [
    "script",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      script: "return fetch('https://invalid.example')",
    }),
  ],
  [
    "secret",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      provenance: { ...m.provenance, apiKey: "private-example" },
    }),
  ],
  [
    "arbitrary effect bag",
    (m: ReturnType<typeof templateFixture>) => ({ ...m, effects: { enabled: true } }),
  ],
  [
    "duplicate requirements",
    (m: ReturnType<typeof templateFixture>) => ({
      ...m,
      requires: ["pipeline.name", "pipeline.name"],
    }),
  ],
])("rejects unsupported or malformed %s", (_name, mutate) => {
  expect(readProcessTemplateManifest(JSON.stringify(mutate(templateFixture()))).ok).toBe(false);
});

test("rejects duplicate JSON keys, including Unicode-escaped aliases at nested boundaries", () => {
  const text = JSON.stringify(templateFixture());
  for (const input of [
    text.replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1'),
    text.replace(
      '"templateKey":"standard-sales"',
      '"templateKey":"other","\\u0074emplateKey":"standard-sales"',
    ),
    text.replace('"rottingDays":7', '"rottingDays":99,"rottingDays":7'),
  ]) {
    const result = readProcessTemplateManifest(input);
    expect(result).toEqual({ ok: false, error: { code: "duplicate-key", paths: [] } });
  }
});

test.each(["__proto__", "constructor", "prototype"])(
  "rejects injected %s keys without polluting prototypes",
  (key) => {
    const text = JSON.stringify(templateFixture()).replace(
      '"schemaVersion":1',
      `"${key}":{"polluted":true},"schemaVersion":1`,
    );
    expect(readProcessTemplateManifest(text).ok).toBe(false);
    expect(Object.prototype).not.toHaveProperty("polluted");
  },
);

test("bounds UTF-8 bytes before parsing and exposes no input values in diagnostics", () => {
  const text = JSON.stringify(templateFixture()).replace('"فروش"', `"${"ن".repeat(33000)}"`);
  expect(text.length).toBeLessThan(65536);
  const result = readProcessTemplateManifest(text);
  expect(result).toEqual({ ok: false, error: { code: "manifest-too-large", paths: [] } });
  const secret = "private-example-do-not-echo";
  const invalid = readProcessTemplateManifest(
    JSON.stringify({ ...templateFixture(), apiKey: secret }),
  );
  expect(JSON.stringify(invalid)).not.toContain(secret);
});

test("returns a fully immutable manifest detached from input and preserves authored whitespace", () => {
  const input = templateFixture();
  input.stages[0].name.fa = "  بررسی / DACH  ";
  const result = readProcessTemplateManifest(JSON.stringify(input));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.stages[0]?.name.fa).toBe("  بررسی / DACH  ");
  expect(Object.isFrozen(result.value)).toBe(true);
  expect(Object.isFrozen(result.value.stages)).toBe(true);
  expect(Object.isFrozen(result.value.stages[0])).toBe(true);
  expect(Object.isFrozen(result.value.stages[0]?.name)).toBe(true);
  expect(Object.isFrozen(result.value.provenance)).toBe(true);
  expect(Object.isFrozen(result.value.requires)).toBe(true);
  input.stages[0].name.fa = "changed";
  expect(result.value.stages[0]?.name.fa).toBe("  بررسی / DACH  ");
});

test("requires declarations for every supported stage field", () => {
  const input = { ...templateFixture(), requires: ["pipeline.name"] };
  expect(readProcessTemplateManifest(JSON.stringify(input)).ok).toBe(false);
});
