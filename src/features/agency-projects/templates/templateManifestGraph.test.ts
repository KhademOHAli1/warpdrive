import { describe, expect, it } from "vitest";
import { parseTemplateManifestJson } from "./templateManifest";
import { manifestFixture } from "./templateManifest.test-support";

function expectInvalid(value: unknown) {
  expect(parseTemplateManifestJson(JSON.stringify(value))).toEqual({
    ok: false,
    error: "invalid_manifest",
  });
}

describe("template manifest graph constraints", () => {
  it.each(["roles", "stages", "deliverables", "intents"] as const)(
    "rejects duplicate %s IDs",
    (collection) => {
      const value = manifestFixture();
      expectInvalid({ ...value, [collection]: [...value[collection], value[collection][0]] });
    },
  );

  it("rejects cross-kind duplicate IDs to keep install mappings unambiguous", () => {
    const value = manifestFixture();
    expectInvalid({ ...value, deliverables: [{ ...value.deliverables[0], id: "producer" }] });
  });

  it("rejects invalid stage references from deliverables and intents", () => {
    const value = manifestFixture();
    expectInvalid({ ...value, deliverables: [{ ...value.deliverables[0], stageId: "missing" }] });
    expectInvalid({ ...value, intents: [{ ...value.intents[0], stageId: "missing" }] });
    expectInvalid({ ...value, stages: [{ ...value.stages[0], dependsOn: ["missing"] }] });
  });

  it("rejects invalid deliverable or task dependency references", () => {
    const value = manifestFixture();
    const assignment = value.intents[1];
    expectInvalid({
      ...value,
      intents: [value.intents[0], { ...assignment, deliverableId: "missing" }],
    });
    expectInvalid({ ...value, intents: [{ ...value.intents[0], dependsOn: ["missing"] }] });
  });

  it("rejects intent referencing a deliverable from a later stage", () => {
    const value = manifestFixture();
    expectInvalid({
      ...value,
      intents: [value.intents[0], { ...value.intents[1], stageId: "briefing" }, value.intents[2]],
    });
  });

  it("rejects missing, wrong-kind and swapped role references", () => {
    const value = manifestFixture();
    expectInvalid({
      ...value,
      deliverables: [{ ...value.deliverables[0], responsibleRoleId: "missing" }],
    });
    expectInvalid({
      ...value,
      deliverables: [{ ...value.deliverables[0], responsibleRoleId: "modeler" }],
    });
    expectInvalid({ ...value, intents: [{ ...value.intents[0], assigneeRoleId: "modeler" }] });
    expectInvalid({
      ...value,
      intents: [value.intents[0], { ...value.intents[1], internalProducerRoleId: "modeler" }],
    });
    expectInvalid({
      ...value,
      intents: [value.intents[0], { ...value.intents[1], freelancerRoleId: "producer" }],
    });
  });

  it("rejects duplicate dependency edges", () => {
    const value = manifestFixture();
    expectInvalid({
      ...value,
      stages: [value.stages[0], { ...value.stages[1], dependsOn: ["briefing", "briefing"] }],
    });
    expectInvalid({
      ...value,
      intents: [
        value.intents[0],
        { ...value.intents[1], dependsOn: ["brief_followup", "brief_followup"] },
      ],
    });
  });

  it("rejects stage self-dependency and multi-stage cycles", () => {
    const value = manifestFixture();
    expectInvalid({ ...value, stages: [{ ...value.stages[0], dependsOn: ["briefing"] }] });
    expectInvalid({
      ...value,
      stages: [{ ...value.stages[0], dependsOn: ["production"] }, value.stages[1]],
    });
  });

  it("rejects task self-dependency and multi-task cycles", () => {
    const value = manifestFixture();
    expectInvalid({ ...value, intents: [{ ...value.intents[0], dependsOn: ["brief_followup"] }] });
    expectInvalid({
      ...value,
      intents: [
        value.intents[0],
        { ...value.intents[1], dependsOn: ["model_review"] },
        value.intents[2],
      ],
    });
  });

  it("rejects a dependency pointing into a later or unrelated stage", () => {
    const value = manifestFixture();
    expectInvalid({
      ...value,
      intents: [
        { ...value.intents[0], dependsOn: ["model_assignment"] },
        value.intents[1],
        value.intents[2],
      ],
    });
    expectInvalid({ ...value, stages: [value.stages[0], { ...value.stages[1], dependsOn: [] }] });
  });

  it("accepts an acyclic branching task graph and declared ancestor-stage dependencies", () => {
    const value = manifestFixture();
    value.intents[2] = { ...value.intents[2], dependsOn: ["brief_followup", "model_assignment"] };
    expect(parseTemplateManifestJson(JSON.stringify(value))).toEqual({ ok: true, value });
  });

  it("allows a later review checkpoint to reference its earlier deliverable stage", () => {
    const value = manifestFixture();
    const laterReview = {
      ...value,
      stages: [...value.stages, { id: "reviewing", label: value.label, dependsOn: ["production"] }],
      intents: [value.intents[0], value.intents[1], { ...value.intents[2], stageId: "reviewing" }],
    };
    expect(parseTemplateManifestJson(JSON.stringify(laterReview))).toEqual({
      ok: true,
      value: laterReview,
    });
  });
});
