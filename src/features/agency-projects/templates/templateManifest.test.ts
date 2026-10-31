import { describe, expect, it } from "vitest";
import { parseTemplateManifestJson } from "./templateManifest";
import { manifestFixture } from "./templateManifest.test-support";

function expectInvalid(value: unknown) {
  expect(parseTemplateManifestJson(JSON.stringify(value))).toEqual({
    ok: false,
    error: "invalid_manifest",
  });
}

describe("template manifest v1 boundary", () => {
  it("preserves FA/DE/EN labels and accepts only unresolved production intent", () => {
    const value = manifestFixture();
    const result = parseTemplateManifestJson(JSON.stringify(value));
    expect(result).toEqual({ ok: true, value });
    if (!result.ok) return;
    expect(result.value).not.toBe(value);
    expect(result.value.label.fa).toBe("مدل‌سازی پروژه");
    expect(result.value.label.de).toBe("Überprüfung پروژه");
    expect(result.value.intents.map((intent) => intent.kind)).toEqual([
      "follow-up",
      "assignment",
      "review",
    ]);
  });

  it.each([0, 2, "1", null])("rejects unsupported schema version %s", (schemaVersion) => {
    expectInvalid({ ...manifestFixture(), schemaVersion });
  });

  it.each([0, -1, 1.5, 1_000_001, "2"])("rejects publication version %s", (version) => {
    expectInvalid({ ...manifestFixture(), version });
  });

  it.each([
    "person@example.com",
    "b0769c87-71e0-4d2e-9916-49b8eaf9718c",
    "../model",
    "",
    "UPPERCASE",
  ])("rejects identity/path-shaped or unstable template ID %s", (templateId) => {
    expectInvalid({ ...manifestFixture(), templateId });
  });

  it.each(["fa", "de", "en"] as const)("requires the %s label", (language) => {
    const value = manifestFixture();
    const label: Partial<typeof value.label> = value.label;
    delete label[language];
    expectInvalid({ ...value, label });
  });

  it("rejects unknown localized keys, empty labels and control characters", () => {
    expectInvalid({
      ...manifestFixture(),
      label: { fa: "فارسی", de: "Deutsch", en: "English", ar: "Arabic" },
    });
    expectInvalid({ ...manifestFixture(), label: { fa: " ", de: "Deutsch", en: "English" } });
    expectInvalid({
      ...manifestFixture(),
      label: { fa: "فارسی\u0000", de: "Deutsch", en: "English" },
    });
  });

  it.each(["\u007f", "\u0085", "\u009f", "\u2028", "\u2029"])(
    "rejects control or nonordinary line break %s in labels and descriptions",
    (control) => {
      const value = manifestFixture();
      expectInvalid({ ...value, label: { ...value.label, fa: `متن${control}` } });
      expectInvalid({ ...value, description: { ...value.description, de: `Text${control}` } });
    },
  );

  it("keeps labels single-line and permits only ordinary newlines in descriptions", () => {
    const value = manifestFixture();
    expectInvalid({ ...value, label: { ...value.label, en: "First\nSecond" } });
    expectInvalid({ ...value, description: { ...value.description, en: "First\tSecond" } });
    const multiline = {
      ...value,
      description: { ...value.description, en: "First\r\nSecond\nThird" },
    };
    expect(parseTemplateManifestJson(JSON.stringify(multiline))).toEqual({
      ok: true,
      value: multiline,
    });
  });

  it.each(["activate", "workflow", "recipients", "userId", "contactId"])(
    "rejects top-level execution/identity field %s",
    (field) => {
      expectInvalid({ ...manifestFixture(), [field]: "unmapped" });
    },
  );

  it("rejects unknown intent kinds and recipient/activation shortcuts inside intent", () => {
    const value = manifestFixture();
    const first = value.intents[0];
    expectInvalid({ ...value, intents: [{ ...first, kind: "mail.send" }] });
    expectInvalid({ ...value, intents: [{ ...first, recipient: "synthetic@example.invalid" }] });
    expectInvalid({ ...value, intents: [{ ...first, activate: true }] });
  });

  it("requires explicit calendar-day basis and anchor without guessing regional rules", () => {
    const value = manifestFixture();
    const first = value.intents[0];
    for (const dueOffset of [
      { days: 2 },
      { basis: "workdays", anchor: "project-start", days: 2 },
      { basis: "calendar-days", anchor: "now", days: 2 },
      { basis: "calendar-days", anchor: "project-start", days: 1.5 },
      { basis: "calendar-days", anchor: "project-start", days: 3_651 },
      { basis: "calendar-days", anchor: "project-start", days: 2, timezone: "Asia/Tehran" },
    ])
      expectInvalid({ ...value, intents: [{ ...first, dueOffset }] });
  });

  it("permits explicit signed day offsets without calculating a date", () => {
    const value = manifestFixture();
    value.intents[0] = {
      ...value.intents[0],
      dueOffset: { basis: "calendar-days", anchor: "project-start", days: -2 },
    };
    expect(parseTemplateManifestJson(JSON.stringify(value)).ok).toBe(true);
  });

  it("bounds text, roles, stages, deliverables and intent collections", () => {
    const value = manifestFixture();
    expectInvalid({ ...value, label: { ...value.label, en: "x".repeat(161) } });
    expectInvalid({ ...value, description: { ...value.description, en: "x".repeat(2_001) } });
    expectInvalid({
      ...value,
      roles: Array.from({ length: 33 }, (_, i) => ({ ...value.roles[0], id: `role_${i}` })),
    });
    expectInvalid({
      ...value,
      stages: Array.from({ length: 33 }, (_, i) => ({
        id: `stage_${i}`,
        label: value.label,
        dependsOn: [],
      })),
    });
    expectInvalid({
      ...value,
      deliverables: Array.from({ length: 129 }, (_, i) => ({
        ...value.deliverables[0],
        id: `deliverable_${i}`,
      })),
    });
    expectInvalid({
      ...value,
      intents: Array.from({ length: 257 }, (_, i) => ({ ...value.intents[0], id: `intent_${i}` })),
    });
  });

  it("bounds UTF-8 JSON before parsing, including multibyte input", () => {
    expect(parseTemplateManifestJson(" ".repeat(131_073))).toEqual({
      ok: false,
      error: "manifest_too_large",
    });
    expect(parseTemplateManifestJson("ی".repeat(65_537))).toEqual({
      ok: false,
      error: "manifest_too_large",
    });
  });

  it.each(["{", "null", "[]", "42"])("rejects malformed or non-object JSON %s", (source) => {
    expect(parseTemplateManifestJson(source).ok).toBe(false);
  });

  it("rejects URL-fetch, registry-action and bound-identity fields", () => {
    const value = manifestFixture();
    expectInvalid({ ...value, fetch: "https://example.invalid/brief" });
    expectInvalid({ ...value, intents: [{ ...value.intents[0], action: "activity.create" }] });
    expectInvalid({ ...value, roles: [{ ...value.roles[0], userId: "producer" }] });
    expectInvalid({ ...value, roles: [{ ...value.roles[1], contactId: "freelancer" }] });
  });
});
