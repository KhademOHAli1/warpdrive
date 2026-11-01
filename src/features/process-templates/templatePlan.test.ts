import { expect, test } from "vitest";
import { templateFixture } from "./templateFixtures";
import { readProcessTemplateManifest } from "./templateManifest";
import { planProcessTemplate } from "./templatePlan";

test("plans only new native stage configuration with stable keys and no UUID allocation", () => {
  const manifest = readProcessTemplateManifest(JSON.stringify(templateFixture()));
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) return;
  const result = planProcessTemplate(manifest.value, "fa");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toMatchObject({
    kind: "preview-only",
    locale: "fa",
    nativeIds: "unallocated",
    installation: "unavailable",
    pipeline: {
      operation: "create-pipeline",
      operationKey: "standard-sales@1/pipeline",
      name: "فروش / DACH",
    },
    stages: [
      {
        operation: "create-stage",
        operationKey: "standard-sales@1/stages/review",
        stageKey: "review",
        pipelineOperationKey: "standard-sales@1/pipeline",
        name: "بررسی اولیه",
        order: 0,
        rottingDays: null,
      },
      { stageKey: "proposal", name: "پیشنهاد", order: 1, rottingDays: 7 },
    ],
  });
  expect(JSON.stringify(result.value)).not.toMatch(
    /"(?:id|pipelineId|stageId|visibilityGroupId|ownerId)"/,
  );
});

test("blocks unknown capability requirements with no partial plan or implicit execution", () => {
  const input = templateFixture();
  input.requires.push("stage-rules.required-fields", "automation.send-mail");
  const manifest = readProcessTemplateManifest(JSON.stringify(input));
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) return;
  const result = planProcessTemplate(manifest.value, "fa");
  expect(result).toEqual({
    ok: false,
    error: {
      code: "unsupported-capability",
      capabilities: ["automation.send-mail", "stage-rules.required-fields"],
    },
  });
  expect(result).not.toHaveProperty("value");
});

test("locale selection changes only proposed copy and retains stable mapping and authored input", () => {
  const input = templateFixture();
  const manifest = readProcessTemplateManifest(JSON.stringify(input));
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) return;
  const original = JSON.stringify(manifest.value);
  const fa = planProcessTemplate(manifest.value, "fa");
  const de = planProcessTemplate(manifest.value, "de");
  expect(fa.ok && de.ok).toBe(true);
  if (!fa.ok || !de.ok) return;
  expect(de.value.pipeline.name).toBe("Vertrieb / فروش");
  expect(fa.value.pipeline.operationKey).toBe(de.value.pipeline.operationKey);
  expect(fa.value.stages.map((stage) => stage.operationKey)).toEqual(
    de.value.stages.map((stage) => stage.operationKey),
  );
  expect(JSON.stringify(manifest.value)).toBe(original);
  expect(JSON.parse(original)).toEqual(input);
  expect(Object.isFrozen(fa.value)).toBe(true);
  expect(Object.isFrozen(fa.value.stages)).toBe(true);
  expect(Object.isFrozen(fa.value.stages[0])).toBe(true);
  expect(Object.isFrozen(fa.value.pipeline)).toBe(true);
  expect(Object.isFrozen(fa.value.template)).toBe(true);
});

test("mapping uses stable keys rather than names and remains deterministic across JSON key order", () => {
  const input = templateFixture();
  input.stages[1].name = { ...input.stages[0].name };
  const first = readProcessTemplateManifest(JSON.stringify(input));
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  const second = readProcessTemplateManifest(JSON.stringify(reordered));
  expect(first.ok && second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  const a = planProcessTemplate(first.value, "en");
  const b = planProcessTemplate(second.value, "en");
  expect(a).toEqual(b);
  if (!a.ok) return;
  expect(a.value.stages.map((stage) => stage.name)).toEqual(["Initial review", "Initial review"]);
  expect(a.value.stages.map((stage) => stage.operationKey)).toEqual([
    "standard-sales@1/stages/review",
    "standard-sales@1/stages/proposal",
  ]);
  expect(a.value.stages.map((stage) => stage.rottingDays)).toEqual([null, 7]);
});
