import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { CustomFieldDef } from "@/types/customFields";
import type { ConfigurationMetadata } from "./configurationTypes";
import { describeMappingTarget } from "./mappingCatalog";
import type { WorkflowDefinition } from "./schemas";

export const mappingFieldId = "11111111-1111-4111-8111-111111111111";
export function mappingField(type: CustomFieldDef["type"]): CustomFieldDef {
  return {
    id: mappingFieldId,
    targetEntity: "activity",
    type,
    name: "Mapped field",
    key: "mapped_field",
    options: [{ id: "a", label: "Active" }],
    isRequired: false,
    isImportant: false,
    showInAddForm: false,
    order: 0,
    archivedAt: null,
  };
}
export function mappingGraph(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read deal",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      {
        id: "check",
        type: "condition",
        version: 1,
        name: "Check",
        config: {
          left: { kind: "reference", nodeId: "read", path: ["status"] },
          operator: "equals",
          right: { kind: "value", value: "open" },
        },
      },
      {
        id: "wait",
        type: "delay",
        version: 1,
        name: "Wait",
        config: { minutes: { kind: "value", value: 1 } },
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
      {
        id: "other",
        type: "activity.create",
        version: 1,
        name: "Other branch",
        config: { subject: { kind: "value", value: "Other" } },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "check", port: "next" },
      { from: "check", to: "wait", port: "true" },
      { from: "wait", to: "task", port: "next" },
      { from: "check", to: "other", port: "false" },
    ],
  };
}
export const noMappingFields: ConfigurationMetadata = { status: "complete", defs: [] };
export function mappingTarget(
  definition: WorkflowDefinition,
  path: string[],
  metadata: ConfigurationMetadata = noMappingFields,
) {
  const result = describeMappingTarget(definition, "task", path, metadata);
  if (result.state !== "ready")
    throw new AppError(ERROR_IDS.WORKFLOW_INVALID, `Fixture target unavailable: ${result.reason}`);
  return result.target;
}
export function reference(nodeId: string, field: string) {
  return { kind: "reference" as const, nodeId, path: [field] };
}
