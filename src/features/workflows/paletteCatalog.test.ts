import { expect, it } from "vitest";
import { creatableNodeTypes } from "./nodeFactory";
import { findPaletteEntry, paletteCatalog } from "./paletteCatalog";
import { executableNode } from "./readiness";
import { nodeTypes, type WorkflowNode } from "./schemas";

it("classifies exactly the eight known version-one entries in deliberate order", () => {
  expect(paletteCatalog.map((entry) => entry.type)).toEqual([
    "trigger.manual",
    "trigger.record",
    "record.read",
    "activity.create",
    "notification",
    "condition",
    "filter",
    "delay",
  ]);
  expect(new Set(paletteCatalog.map((entry) => entry.type))).toEqual(new Set(nodeTypes));
  for (const entry of paletteCatalog) {
    expect(entry.version).toBe(1);
    expect(findPaletteEntry(entry.type, 1)).toBe(entry);
  }
});

it("keeps only the five factory types insertable and configures the existing manual trigger", () => {
  expect(
    paletteCatalog
      .filter((entry) => entry.selection === "insert")
      .map((entry) => entry.type)
      .sort(),
  ).toEqual([...creatableNodeTypes].sort());
  expect(
    paletteCatalog.filter((entry) => entry.selection === "configure").map((entry) => entry.type),
  ).toEqual(["trigger.manual"]);
  expect(
    paletteCatalog.filter((entry) => entry.selection === "unavailable").map((entry) => entry.type),
  ).toEqual(["trigger.record", "notification"]);
});

it("describes supported runtime subsets without promoting broader schema variants", () => {
  expect(
    paletteCatalog.filter((entry) => entry.support === "supported").map((entry) => entry.profile),
  ).toEqual([
    "manual-trigger",
    "deal-read",
    "basic-task",
    "scalar-condition",
    "scalar-condition",
    "literal-duration",
  ]);
  const node = (type: WorkflowNode["type"], config: WorkflowNode["config"]): WorkflowNode => ({
    id: "example",
    type,
    version: 1,
    name: "Example",
    config,
  });
  expect(executableNode(node("record.read", { entity: "deal" }))).toBe(true);
  expect(executableNode(node("record.read", { entity: "person" }))).toBe(false);
  expect(executableNode(node("condition", { operator: "equals" }))).toBe(true);
  expect(executableNode(node("condition", { operator: "greaterThan" }))).toBe(false);
  expect(executableNode(node("delay", { minutes: { kind: "value", value: 1 } }))).toBe(true);
  expect(
    executableNode(
      node("delay", { minutes: { kind: "reference", nodeId: "start", path: ["recordId"] } }),
    ),
  ).toBe(false);
});

it("provides categories and real label/description keys for the finite localized catalog", () => {
  expect(new Set(paletteCatalog.map((entry) => entry.category))).toEqual(
    new Set(["triggers", "crm", "logic", "timing"]),
  );
  expect(new Set(paletteCatalog.map((entry) => entry.categoryKey))).toEqual(
    new Set([
      "paletteCategoryTriggers",
      "paletteCategoryCrm",
      "paletteCategoryLogic",
      "paletteCategoryTiming",
    ]),
  );
  expect(findPaletteEntry("trigger.manual", 1)).toMatchObject({
    labelKey: "paletteManual",
    descriptionKey: "paletteManualHint",
  });
  expect(findPaletteEntry("trigger.record", 1)).toMatchObject({
    labelKey: "paletteRecordTrigger",
    descriptionKey: "paletteRecordTriggerHint",
  });
  expect(findPaletteEntry("notification", 1)).toMatchObject({
    labelKey: "notification",
    descriptionKey: "paletteNotificationHint",
  });
  expect(findPaletteEntry("delay", 1)).toMatchObject({
    labelKey: "delay",
    descriptionKey: "delayMinutesHint",
  });
});

it("fails closed for unknown types and nonliteral supported versions", () => {
  for (const type of ["__proto__", "email.send", "", null, {}])
    expect(findPaletteEntry(type, 1)).toBeUndefined();
  for (const version of [0, 2, "1", null, undefined, {}])
    expect(findPaletteEntry("record.read", version)).toBeUndefined();
});

it("separates unavailable handlers from provider-free offered paths", () => {
  for (const entry of paletteCatalog) {
    if (entry.support === "supported")
      expect(entry).toMatchObject({ supportReason: null, provider: "not-required" });
    else
      expect(entry).toMatchObject({
        selection: "unavailable",
        profile: "unavailable",
        supportReason: "handler-unavailable",
        provider: "not-assessed",
      });
  }
});

it("exports bounded data descriptors with no schemas, handlers or private state", () => {
  const fields = [
    "type",
    "version",
    "category",
    "categoryKey",
    "labelKey",
    "descriptionKey",
    "selection",
    "profile",
    "input",
    "support",
    "supportReason",
    "provider",
  ].sort();
  for (const entry of paletteCatalog) {
    expect(Object.keys(entry).sort()).toEqual(fields);
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  }
});
