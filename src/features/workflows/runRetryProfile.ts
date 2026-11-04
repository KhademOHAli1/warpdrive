import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { workflowRuns, workflowSteps } from "@/db/schema";
import { validateDefinition } from "./definition";
import { executableDefinition } from "./readiness";
import { bindingSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";

type Run = typeof workflowRuns.$inferSelect;
type Step = typeof workflowSteps.$inferSelect;

function references(raw: unknown, nodeId: string, property: string): boolean {
  const binding = bindingSchema.safeParse(raw);
  return (
    binding.success &&
    binding.data.kind === "reference" &&
    binding.data.nodeId === nodeId &&
    binding.data.path.length === 1 &&
    binding.data.path[0] === property
  );
}

function linkedToTrigger(raw: unknown, definition: WorkflowDefinition, triggerId: string): boolean {
  if (references(raw, triggerId, "recordId")) return true;
  return definition.nodes.some(
    (node) => node.type === "record.read" && references(raw, node.id, "id"),
  );
}

function taskConfiguration(node: WorkflowNode, definition: WorkflowDefinition, triggerId: string) {
  const subject = bindingSchema.safeParse(node.config.subject);
  return (
    // Rich custom values have separate current-metadata/reference authority. The
    // older retry profile has no qualified provenance path for those values.
    !Object.hasOwn(node.config, "customFields") &&
    subject.success &&
    subject.data.kind === "value" &&
    typeof subject.data.value === "string" &&
    subject.data.value.length > 0 &&
    subject.data.value.length <= 255 &&
    linkedToTrigger(node.config.dealId, definition, triggerId)
  );
}

function usesNewMappingContract(node: WorkflowNode): boolean {
  return Object.values(node.config).some((raw) => {
    const parsed = bindingSchema.safeParse(raw);
    if (!parsed.success) return false;
    const binding = parsed.data;
    if (binding.kind === "value") return Object.hasOwn(binding, "literalType");
    return binding.path.length === 1 && binding.path[0] === "expectedCloseDate";
  });
}

// Initial retry support is the existing database-only deal follow-up profile.
// A saved arbitrary string from an old CRM output must not become a new unlinked
// task after access to that source record changes. Literal subjects and a visible
// trigger deal retain an explicit authorization path for every future effect.
export function retryableTaskDefinition(raw: unknown): WorkflowDefinition | null {
  const parsed = validateDefinition(raw);
  if (!parsed.ok || !executableDefinition(parsed.value)) return null;
  const definition = parsed.value;
  // WF020 authoring/runtime qualification does not qualify recovery for new wire
  // intent or new historical output fields in the older failed-task profile.
  if (definition.nodes.some(usesNewMappingContract)) return null;
  const trigger = definition.nodes.find((node) => node.type === "trigger.manual");
  if (trigger === undefined) return null;
  const safe = definition.nodes.every((node) => {
    if (node.type === "record.read")
      return references(node.config.recordId, trigger.id, "recordId");
    if (node.type === "activity.create") return taskConfiguration(node, definition, trigger.id);
    return node.type === "trigger.manual" || node.type === "condition" || node.type === "delay";
  });
  return safe ? definition : null;
}

function validCompletedOutput(node: WorkflowNode, step: Step, run: Run): boolean {
  if (
    step.runId !== run.id ||
    step.simulated ||
    !(step.completedAt instanceof Date) ||
    !Number.isFinite(step.completedAt.getTime()) ||
    !isDeepStrictEqual(step.output, run.outputs[node.id])
  )
    return false;
  if (node.type === "trigger.manual") return step.output.recordId === run.trigger.recordId;
  if (node.type === "record.read") return step.output.id === run.trigger.recordId;
  if (node.type === "condition") return typeof step.output.result === "boolean";
  if (node.type === "activity.create") return z.uuid().safeParse(step.output.id).success;
  return node.type === "delay" && z.iso.datetime().safeParse(step.output.resumeAt).success;
}

function exactOutputPrefix(run: Run, visited: Set<string>, completedSize: number) {
  const keys = Object.keys(run.outputs);
  return (
    visited.size === completedSize &&
    keys.length === visited.size &&
    keys.every((key) => visited.has(key))
  );
}

function completedPort(node: WorkflowNode, step: Step) {
  if (node.type !== "condition") return "next";
  return step.output.result === true ? "true" : "false";
}

// Completed effects/outputs are an inseparable prefix of the pinned path. Do not
// delete, synthesize or replay them to repair a malformed stored execution.
export function coherentFailedTask(
  definition: WorkflowDefinition,
  run: Run,
  steps: Step[],
): WorkflowNode | null {
  if (
    !z
      .strictObject({
        trigger: z.strictObject({ recordId: z.uuid() }),
        outputs: z.record(z.string(), z.record(z.string(), z.json())),
      })
      .safeParse({ trigger: run.trigger, outputs: run.outputs }).success
  )
    return null;
  const task = definition.nodes.find((node) => node.id === run.nextNodeId);
  const trigger = definition.nodes.find((node) => node.type === "trigger.manual");
  if (
    task?.type !== "activity.create" ||
    trigger === undefined ||
    !z.uuid().safeParse(run.trigger.recordId).success
  )
    return null;
  const completed = new Map(steps.map((step) => [step.nodeId, step]));
  const visited = new Set<string>();
  if (completed.size !== steps.length || completed.has(task.id)) return null;
  let current: string = trigger.id;
  for (let count = 0; count <= definition.nodes.length; count++) {
    if (current === task.id) {
      return exactOutputPrefix(run, visited, completed.size) ? task : null;
    }
    const node = definition.nodes.find((item) => item.id === current);
    const step = completed.get(current);
    if (
      node === undefined ||
      step === undefined ||
      visited.has(current) ||
      !validCompletedOutput(node, step, run)
    )
      return null;
    visited.add(current);
    const port = completedPort(node, step);
    const edge = definition.edges.find((item) => item.from === current && item.port === port);
    if (edge === undefined) return null;
    current = edge.to;
  }
  return null;
}
