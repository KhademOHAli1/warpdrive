import { z } from "zod";
import type { ConfigurationContext, ConfigurationValidation } from "./configurationTypes";
import type { WorkflowNode } from "./schemas";
import {
  workflowIteratorConfig,
  workflowIteratorMaxItems,
  workflowIteratorMaxTextLength,
  workflowIteratorSearchSources,
} from "./workflowIteratorRuntimeContract";

export const workflowIteratorDraftCopyConfig = z.strictObject({
  items: workflowIteratorConfig.shape.items.optional(),
  shouldContinueOnIterationFailure: z.boolean().optional(),
});

export function boundedWorkflowIteratorConfig(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || !Object.hasOwn(raw, "items")) return true;
  const items: unknown = Reflect.get(raw, "items");
  if (items === null || typeof items !== "object" || !Object.hasOwn(items, "items")) return true;
  const values: unknown = Reflect.get(items, "items");
  return (
    Array.isArray(values) &&
    values.length <= workflowIteratorMaxItems &&
    values.every(
      (value) =>
        value === null ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.length <= workflowIteratorMaxTextLength * 2),
    )
  );
}

export function iteratorSourceIsUpstream(
  definition: ConfigurationContext["definition"],
  node: WorkflowNode,
  sourceId: string,
): boolean {
  return workflowIteratorSearchSources(definition, node.id).some(
    (source) => source.id === sourceId,
  );
}

export function validateWorkflowIteratorConfiguration(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const parsed = workflowIteratorConfig.safeParse(node.config);
  if (!parsed.success) {
    result.issues.push({ nodeId: node.id, path: ["items"], code: "invalid_value" });
    return;
  }
  const items = parsed.data.items;
  if (
    items.kind === "reference" &&
    !iteratorSourceIsUpstream(context.definition, node, items.nodeId)
  )
    result.issues.push({ nodeId: node.id, path: ["items"], code: "reference_missing" });
}
