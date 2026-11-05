import { describe, expect, it } from "vitest";
import { CUSTOM_FIELD_TYPES } from "@/constants/customFieldTypes";
import type { CustomFieldDef } from "@/types/customFields";
import {
  conditionSourceDefaults,
  defaultConfiguration,
  getConfigurationSpec,
} from "./configurationSpec";
import { makeNode } from "./nodeFactory";
import { nodeTypes, type WorkflowDefinition } from "./schemas";

const id = "11111111-1111-4111-8111-111111111111";
function field(type: CustomFieldDef["type"]): CustomFieldDef {
  return {
    id,
    type,
    targetEntity: "activity",
    name: "Follow-up code",
    key: "follow_up_code",
    options: [],
    isRequired: false,
    isImportant: true,
    showInAddForm: false,
    order: 0,
    archivedAt: null,
  };
}
const metadata = { status: "complete", defs: [] } as const;

describe("shared configuration profile descriptors", () => {
  it("covers exactly the finite registry and rejects unknown action/version inputs", () => {
    for (const type of nodeTypes) expect(getConfigurationSpec(type, 1, metadata)?.type).toBe(type);
    expect(getConfigurationSpec("custom.execute", 1, metadata)).toBeNull();
    expect(getConfigurationSpec("activity.create", 2, metadata)).toBeNull();
    expect(getConfigurationSpec("activity.create", "1", metadata)).toBeNull();
  });

  it("uses one common name contract for all seven known profiles", () => {
    for (const type of nodeTypes) {
      expect(getConfigurationSpec(type, 1, metadata)?.fields).toContainEqual(
        expect.objectContaining({
          path: ["name"],
          control: "name",
          required: true,
          nullable: false,
          constraints: { minLength: 1, maxLength: 120, trim: true },
        }),
      );
    }
    expect(defaultConfiguration("trigger.manual", {})).toEqual({});
  });

  it("declares deal identity and a nonnullable required read setting", () => {
    expect(getConfigurationSpec("record.read", 1, metadata)?.fields).toContainEqual(
      expect.objectContaining({
        path: ["recordId"],
        required: true,
        nullable: false,
        valueType: "deal",
        modes: ["literal", "reference"],
      }),
    );
  });

  it("separates required task subject from optional nullable linked deal", () => {
    const spec = getConfigurationSpec("activity.create", 1, metadata);
    expect(spec?.fields).toContainEqual(
      expect.objectContaining({
        path: ["subject"],
        required: true,
        constraints: { minLength: 1, maxLength: 255, trim: true },
      }),
    );
    expect(spec?.fields).toContainEqual(
      expect.objectContaining({
        path: ["dealId"],
        required: false,
        nullable: true,
        modes: ["literal", "reference", "null", "omit"],
      }),
    );
  });

  it("renders optional important fields omitted from Add without promoting their requirement", () => {
    const def = field("text");
    const spec = getConfigurationSpec("activity.create", 1, { status: "complete", defs: [def] });
    expect(spec?.fields).toContainEqual(
      expect.objectContaining({
        path: ["customFields", id],
        label: "Follow-up code",
        labelSource: "metadata",
        control: "custom",
        required: false,
        nullable: false,
        customField: def,
      }),
    );
  });

  it("describes all sixteen canonical custom types without making any nullable", () => {
    for (const type of CUSTOM_FIELD_TYPES) {
      const spec = getConfigurationSpec("activity.create", 1, {
        status: "complete",
        defs: [field(type)],
      });
      const custom = spec?.fields.find((entry) => entry.control === "custom");
      expect(custom).toMatchObject({ valueType: type, nullable: false, required: false });
      expect(custom?.modes).toContain("omit");
      expect(custom?.modes).not.toContain("null");
    }
  });

  it("describes conditional right requirement and existing operators", () => {
    const fields = getConfigurationSpec("condition", 1, metadata)?.fields;
    expect(fields).toContainEqual(
      expect.objectContaining({
        path: ["right"],
        requiredWhen: { field: "operator", not: "exists" },
      }),
    );
    expect(fields).toContainEqual(
      expect.objectContaining({
        path: ["operator"],
        choices: ["exists", "equals", "notEquals", "contains"],
      }),
    );
    expect(conditionSourceDefaults({ type: "boolean" })).toEqual({
      operator: "equals",
      right: { kind: "value", value: true },
    });
    expect(conditionSourceDefaults({ type: "string", field: "status" }).right).toEqual({
      kind: "value",
      value: "open",
    });
    expect(conditionSourceDefaults({ type: "string", field: "title" }).right).toEqual({
      kind: "value",
      value: "",
    });
  });

  it("keeps the legacy wait bound and defaults new waits to the configurable duration", () => {
    expect(getConfigurationSpec("delay", 1, metadata)?.fields).toContainEqual(
      expect.objectContaining({
        path: ["minutes"],
        control: "duration",
        required: true,
        modes: ["literal"],
        constraints: { min: 1, max: 525600, integer: true },
      }),
    );
    expect(defaultConfiguration("delay", {})).toEqual({
      delayType: "DURATION",
      duration: { minutes: { kind: "value", value: 1 } },
    });
  });

  it("keeps unsupported actions and schema-only task settings explicitly read-only", () => {
    expect(getConfigurationSpec("notification", 1, metadata)?.supported).toBe(false);
    expect(getConfigurationSpec("trigger.record", 1, metadata)?.supported).toBe(false);
    const fields = getConfigurationSpec("activity.create", 1, metadata)?.fields;
    for (const key of ["assigneeId", "dueAt", "typeId"]) {
      expect(fields).toContainEqual(expect.objectContaining({ path: [key], readOnly: true }));
    }
  });

  it("delegates connected factory defaults without mutating the source graph", () => {
    const graph: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} }],
      edges: [],
    };
    const before = structuredClone(graph);
    expect(makeNode(graph, "delay", "wait", "Wait", "Call", "start").config).toEqual(
      defaultConfiguration("delay", { trigger: graph.nodes[0] }),
    );
    expect(makeNode(graph, "condition", "check", "Check", "Call", "start").config).toEqual(
      defaultConfiguration("condition", { trigger: graph.nodes[0] }),
    );
    expect(graph).toEqual(before);
  });
});
