import { z } from "zod";
import type { WorkflowDefinition } from "./schemas";

export const workflowManualLaunchConfig = z.strictObject({ scope: z.literal("global").optional() });

export const workflowManualLaunchPayload = z.union([
  z.strictObject({ recordId: z.uuid() }),
  z.strictObject({ scope: z.literal("global") }),
]);
export type WorkflowManualLaunchPayload = z.infer<typeof workflowManualLaunchPayload>;

export function workflowManualLaunchScope(raw: unknown): "deal" | "global" | null {
  const parsed = workflowManualLaunchConfig.safeParse(raw);
  return parsed.success ? (parsed.data.scope ?? "deal") : null;
}

export function matchWorkflowManualLaunch(
  config: unknown,
  raw: unknown,
): WorkflowManualLaunchPayload | null {
  const payload = workflowManualLaunchPayload.safeParse(raw);
  if (!payload.success) return null;
  const scope = "recordId" in payload.data ? "deal" : "global";
  return workflowManualLaunchScope(config) === scope ? payload.data : null;
}

export function prepareWorkflowManualLaunch(
  config: unknown,
  recordId: string | undefined,
): WorkflowManualLaunchPayload | null {
  return matchWorkflowManualLaunch(
    config,
    recordId === undefined ? { scope: "global" } : { recordId },
  );
}

export function readWorkflowManualLaunch(
  definition: Pick<WorkflowDefinition, "nodes">,
  raw: unknown,
): WorkflowManualLaunchPayload | null {
  const triggers = definition.nodes.filter((node) => node.type.startsWith("trigger."));
  const trigger = triggers[0];
  return triggers.length === 1 && trigger?.type === "trigger.manual"
    ? matchWorkflowManualLaunch(trigger.config, raw)
    : null;
}
