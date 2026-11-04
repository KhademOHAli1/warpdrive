import { describe, expect, it } from "vitest";
import type { CustomFieldDef } from "@/types/customFields";
import {
  copyCustomFieldBindingSchema,
  copyCustomFieldSettingsSchema,
  customFieldBindingSchema,
} from "./configurationBindings";
import type { ConfigurationContext } from "./configurationTypes";
import {
  validateNodeConfiguration,
  validateWorkflowConfiguration,
} from "./configurationValidation";
import { validateDefinition } from "./definition";
import { bindingSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";

const fieldId = "11111111-1111-4111-8111-111111111111";
const replacementId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";
function def(type: CustomFieldDef["type"], extra: Partial<CustomFieldDef> = {}): CustomFieldDef {
  return {
    id: fieldId,
    targetEntity: "activity",
    type,
    key: "follow_up_code",
    name: "Follow-up code",
    options: [
      { id: "a", label: "Active" },
      { id: "old", label: "Old", archived: true },
    ],
    isRequired: false,
    isImportant: true,
    showInAddForm: false,
    order: 0,
    archivedAt: null,
    ...extra,
  };
}
function graph(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Task",
        config: {
          subject: { kind: "value", value: "Call" },
          dealId: { kind: "value", value: null },
        },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ],
  };
}
function task(definition: WorkflowDefinition): WorkflowNode {
  const node = definition.nodes.find((entry) => entry.id === "task");
  if (node === undefined) throw new Error("Missing fixture task");
  return node;
}
function context(
  definition: WorkflowDefinition,
  defs: CustomFieldDef[] = [],
): ConfigurationContext {
  return { definition, metadata: { status: "complete", defs } };
}
function resultFor(type: CustomFieldDef["type"], value: WorkflowNode["config"][string]) {
  const definition = graph();
  task(definition).config.customFields = { [fieldId]: { kind: "value", value } };
  return validateNodeConfiguration(task(definition), context(definition, [def(type)]));
}
const validValues: [CustomFieldDef["type"], WorkflowNode["config"][string]][] = [
  ["text", "hello"],
  ["large_text", "long text"],
  ["autocomplete", "choice"],
  ["phone", "+49 1234"],
  ["numeric", 0],
  ["monetary", -1.25],
  ["single_option", "a"],
  ["multi_option", ["a", "a"]],
  ["user", recordId],
  ["person", recordId],
  ["org", recordId],
  ["date", "2026-11-04"],
  ["time", "09:30"],
  ["date_range", { start: "2026-11-04", end: "2026-11-05" }],
  ["time_range", { start: "09:30", end: "10:00" }],
  ["address", { city: "Berlin", country: "DE", lat: 0 }],
];

describe("shared step configuration validation", () => {
  it.each(validValues)("accepts the canonical %s literal without coercion", (type, value) => {
    const before = structuredClone(value);
    const result = resultFor(type, value);
    expect(result.status).toBe("valid");
    expect(result.issues).toEqual([]);
    expect(value).toEqual(before);
    if (["user", "person", "org"].includes(type)) expect(result.runtimeChecks).not.toEqual([]);
  });

  it("distinguishes metadata completeness from an apparently empty task form", () => {
    const definition = graph();
    const result = validateNodeConfiguration(task(definition), { definition });
    expect(result.status).toBe("incomplete-metadata");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "metadata_incomplete", path: ["customFields"] }),
    );
    expect(validateNodeConfiguration(definition.nodes[0]!, { definition }).status).toBe("valid");
  });

  it("requires only isRequired and preserves numeric zero", () => {
    const definition = graph();
    const optional = context(definition, [def("numeric")]);
    expect(validateNodeConfiguration(task(definition), optional).status).toBe("valid");
    const required = context(definition, [def("numeric", { isRequired: true })]);
    expect(validateNodeConfiguration(task(definition), required).issues).toContainEqual(
      expect.objectContaining({ code: "required", path: ["customFields", fieldId] }),
    );
    task(definition).config.customFields = { [fieldId]: { kind: "value", value: 0 } };
    expect(validateNodeConfiguration(task(definition), required).status).toBe("valid");
  });

  it.each([null, "12"])("rejects %j for a numeric custom field", (value) => {
    expect(resultFor("numeric", value).status).toBe("invalid");
  });

  it("retains stable UUID identity across a label rename but rejects a same-key replacement", () => {
    const definition = graph();
    task(definition).config.customFields = { [fieldId]: { kind: "value", value: "kept" } };
    expect(
      validateNodeConfiguration(
        task(definition),
        context(definition, [def("text", { name: "Renamed" })]),
      ).status,
    ).toBe("valid");
    const result = validateNodeConfiguration(
      task(definition),
      context(definition, [def("text", { id: replacementId })]),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "unknown_field", path: ["customFields", fieldId] }),
    );
    expect(task(definition).config.customFields).toEqual({
      [fieldId]: { kind: "value", value: "kept" },
    });
  });

  it("rejects an archived definition and a canonical-key alias", () => {
    const definition = graph();
    task(definition).config.customFields = {
      [fieldId]: { kind: "value", value: "kept" },
      follow_up_code: { kind: "value", value: "alias" },
    };
    const result = validateNodeConfiguration(
      task(definition),
      context(definition, [def("text", { archivedAt: new Date() })]),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "field_archived", path: ["customFields", fieldId] }),
    );
    expect(result.status).toBe("invalid");
  });

  it.each(["date_range", "address"] as const)(
    "rejects unknown nested %s keys instead of stripping",
    (type) => {
      const value: WorkflowNode["config"][string] =
        type === "address"
          ? { country: "DE", secret: "drop me" }
          : { start: "2026-11-04", end: "2026-11-05", secret: "drop me" };
      expect(resultFor(type, value).status).toBe("invalid");
    },
  );

  it("keeps the large-text bound field-scoped and the scalar bound unchanged", () => {
    expect(bindingSchema.safeParse({ kind: "value", value: "x".repeat(50001) }).success).toBe(
      false,
    );
    expect(resultFor("large_text", "x".repeat(65535)).status).toBe("valid");
    expect(resultFor("large_text", "x".repeat(65536)).status).toBe("invalid");
  });

  it("uses active options and canonical monetary precision", () => {
    expect(resultFor("single_option", "old").issues).toContainEqual(
      expect.objectContaining({ code: "option_unavailable" }),
    );
    expect(resultFor("multi_option", ["a", "old"]).status).toBe("invalid");
    expect(resultFor("monetary", -12.5).status).toBe("valid");
    expect(resultFor("monetary", 0.001).status).toBe("invalid");
  });

  it("checks rich binding ancestry and real target compatibility", () => {
    const definition = graph();
    task(definition).config.customFields = {
      [fieldId]: { kind: "reference", nodeId: "read", path: ["value"] },
    };
    expect(
      validateNodeConfiguration(task(definition), context(definition, [def("numeric")])).issues,
    ).toContainEqual(
      expect.objectContaining({ code: "reference_incompatible", path: ["customFields", fieldId] }),
    );
    task(definition).config.customFields = {
      [fieldId]: { kind: "reference", nodeId: "read", path: ["id"] },
    };
    expect(
      validateNodeConfiguration(task(definition), context(definition, [def("person")])).status,
    ).toBe("invalid");
    task(definition).config.customFields = {
      [fieldId]: { kind: "reference", nodeId: "task", path: ["id"] },
    };
    expect(
      validateNodeConfiguration(task(definition), context(definition, [def("text")])).issues,
    ).toContainEqual(expect.objectContaining({ code: "reference_missing" }));
    task(definition).config.customFields = {
      [fieldId]: { kind: "reference", nodeId: "read", path: ["toString"] },
    };
    expect(validateDefinition(definition).ok).toBe(false);
  });

  it("accepts a real ancestor string while deferring its canonical runtime value", () => {
    const definition = graph();
    task(definition).config.customFields = {
      [fieldId]: { kind: "reference", nodeId: "read", path: ["title"] },
    };
    const result = validateNodeConfiguration(
      task(definition),
      context(definition, [def("text", { isRequired: true })]),
    );
    expect(result.status).toBe("valid");
    expect(result.runtimeChecks).toContainEqual(["customFields", fieldId]);
  });

  it("allows builtin null only for the nullable linked deal", () => {
    const definition = graph();
    expect(validateNodeConfiguration(task(definition), context(definition)).status).toBe("valid");
    definition.nodes[1]!.config.recordId = { kind: "value", value: null };
    expect(validateNodeConfiguration(definition.nodes[1]!, context(definition)).status).toBe(
      "invalid",
    );
    expect(validateDefinition(graph()).ok).toBe(true);
  });

  it("shares name, wait and condition field errors without clearing dormant values", () => {
    const definition = graph();
    const node: WorkflowNode = {
      id: "check",
      type: "condition",
      version: 1,
      name: "   ",
      config: {
        left: { kind: "value", value: true },
        operator: "equals",
      },
    };
    const result = validateNodeConfiguration(node, context(definition));
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "required", path: ["name"] }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "required", path: ["right"] }),
    );
    node.name = "Check";
    node.config.operator = "exists";
    node.config.right = { kind: "reference", nodeId: "absent", path: ["id"] };
    expect(validateNodeConfiguration(node, context(definition)).issues).toContainEqual(
      expect.objectContaining({ code: "reference_missing", path: ["right"] }),
    );
    expect(node.config.right).toEqual({ kind: "reference", nodeId: "absent", path: ["id"] });
    const wait: WorkflowNode = {
      id: "wait",
      type: "delay",
      version: 1,
      name: "Wait",
      config: { minutes: { kind: "value", value: 0 } },
    };
    expect(validateNodeConfiguration(wait, context(definition)).issues).toContainEqual(
      expect.objectContaining({ path: ["minutes"], code: "out_of_range" }),
    );
  });

  it("reports unknown and unready settings without changing the input graph", () => {
    const definition = graph();
    task(definition).config.assigneeId = { kind: "value", value: recordId };
    task(definition).config.extra = "retained";
    const before = structuredClone(definition);
    const result = validateWorkflowConfiguration(definition, context(definition));
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: ["assigneeId"], code: "unsupported_setting" }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: ["extra"], code: "unknown_setting" }),
    );
    expect(definition).toEqual(before);
    delete task(definition).config.extra;
    expect(validateDefinition(definition, { status: "complete", defs: [] }).ok).toBe(true);
  });

  it("retains stored exact decimal-string condition comparisons without numeric coercion", () => {
    const definition = graph();
    const node: WorkflowNode = {
      id: "check",
      type: "condition",
      version: 1,
      name: "Check",
      config: {
        left: { kind: "reference", nodeId: "read", path: ["value"] },
        operator: "contains",
        right: { kind: "value", value: ".25" },
      },
    };
    definition.nodes.push(node);
    definition.edges.push({ from: "task", to: "check", port: "next" });
    expect(validateNodeConfiguration(node, context(definition)).status).toBe("valid");
  });
});

describe("strict scoped custom binding and copy boundary", () => {
  it("rejects prototype paths, mixed branches and nested credentials", () => {
    for (const raw of [
      { kind: "reference", nodeId: "read", path: ["__proto__"] },
      { kind: "value", value: "x", nodeId: "read" },
      { kind: "value", value: { country: "DE", credentials: "hidden" } },
    ])
      expect(customFieldBindingSchema.safeParse(raw).success).toBe(false);
  });

  it("preserves reviewed incomplete copy shapes but rejects unsafe or key-based maps", () => {
    for (const raw of [
      {},
      { kind: "value" },
      { kind: "reference", path: [] },
      { kind: "value", value: { start: "2026-11-04" } },
    ]) {
      const parsed = copyCustomFieldBindingSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data).toEqual(raw);
    }
    expect(copyCustomFieldSettingsSchema.safeParse({ [fieldId]: {} }).success).toBe(true);
    expect(copyCustomFieldSettingsSchema.safeParse({ follow_up_code: {} }).success).toBe(false);
    expect(
      copyCustomFieldBindingSchema.safeParse({ kind: "reference", path: [], token: "x" }).success,
    ).toBe(false);
  });
});
