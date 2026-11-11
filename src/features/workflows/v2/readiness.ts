import { z } from "zod";
import type { Db } from "@/db/client";
import { blockReferences, resolveBlockConfig } from "@/features/blocks/bindings";
import { findSharedBlock } from "@/features/blocks/catalog";
import {
  type BlockReadiness,
  isNewsletterTrigger,
  type WorkflowV2Adapters,
  type WorkflowV2Definition,
  type WorkflowV2Node,
  type WorkflowV2Trigger,
} from "@/features/blocks/contracts";
import { newsletterListId, validateResolvedBlockConfig } from "@/features/blocks/schemas";
import type { PermSetUser } from "@/features/permissions/effective";

import { validSchedule } from "./cron";
import { validResponseSchema } from "./responseSchema";
import { isWebhookCredentialDigest } from "./webhookCredential";

const nativeObjects = new Set(["deal", "lead", "person", "organization", "activity"]);
function validNativeObject(value: unknown) {
  return typeof value === "string" && nativeObjects.has(value);
}
const consentTriggerConfig = z.strictObject({ listId: newsletterListId.optional() });
const identityTriggerConfig = z.strictObject({});
export function validWorkflowV2Trigger(trigger: WorkflowV2Trigger): boolean {
  const { type, config } = trigger;
  if (isNewsletterTrigger(type))
    return (
      type === "newsletter.identity.verified" ? identityTriggerConfig : consentTriggerConfig
    ).safeParse(config).success;
  if (type === "schedule") return validSchedule(config);
  if (type === "webhook") {
    const authenticated =
      config.authentication === "api_key" && isWebhookCredentialDigest(config.apiKeyHash);
    return (
      (authenticated || config.authentication === "none") &&
      (config.responseSchema === undefined || validResponseSchema(config.responseSchema))
    );
  }
  if (type === "manual") {
    if (config.availability === undefined || config.availability === "global") return true;
    return (
      (config.availability === "single" || config.availability === "bulk") &&
      validNativeObject(config.objectName)
    );
  }
  return (
    validNativeObject(config.objectName) &&
    (config.updatedFields === undefined ||
      (Array.isArray(config.updatedFields) &&
        config.updatedFields.length <= 40 &&
        config.updatedFields.every((field) => typeof field === "string" && field.length <= 200)))
  );
}
function branchShape(node: WorkflowV2Node): boolean {
  if (node.type !== "IF_ELSE") return true;
  const branches = node.config.branches;
  if (!Array.isArray(branches) || branches.length === 0) return false;
  const ids = new Set<string>();
  for (const [index, branch] of branches.entries()) {
    if (
      branch === null ||
      typeof branch !== "object" ||
      Array.isArray(branch) ||
      typeof branch.id !== "string" ||
      ids.has(branch.id)
    )
      return false;
    if (branch.condition === undefined && index !== branches.length - 1) return false;
    ids.add(branch.id);
  }
  return true;
}
function requiredFlowFields(node: WorkflowV2Node): string[] {
  const keys: Partial<Record<WorkflowV2Node["type"], string[]>> = {
    FILTER: ["condition"],
    IF_ELSE: ["branches"],
    ITERATOR: ["items"],
    DELAY: ["mode", node.config.mode === "date" ? "until" : "seconds"],
    FORM: ["fields"],
    WAIT_FOR_EVENT: ["eventName"],
  };
  return (keys[node.type] ?? []).filter((key) => node.config[key] === undefined);
}
export function pureBlockReadiness(node: WorkflowV2Node): BlockReadiness {
  const missing = requiredFlowFields(node);
  if (missing.length > 0)
    return { state: "needs_configuration", reason: "invalid_configuration", fields: missing };
  if (!branchShape(node)) return { state: "needs_configuration", reason: "else_must_be_last" };
  const literal = resolveBlockConfig(node.config, {}, [], {});
  if (!literal.ok) {
    try {
      return blockReferences(node.config).length > 0
        ? { state: "ready" }
        : { state: "needs_configuration", reason: literal.error };
    } catch {
      return { state: "needs_configuration", reason: "binding_limit" };
    }
  }
  const parsed = validateResolvedBlockConfig(node.type, literal.value);
  return parsed.success
    ? { state: "ready" }
    : {
        state: "needs_configuration",
        reason: "invalid_configuration",
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      };
}
export async function workflowV2Readiness(
  db: Db,
  actor: PermSetUser,
  definition: WorkflowV2Definition,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  const result: Record<string, BlockReadiness> = {};
  for (const node of definition.nodes) {
    signal.throwIfAborted();
    const effect = findSharedBlock(node.type)?.effect;
    result[node.id] =
      effect === "pure" || effect === "wait"
        ? pureBlockReadiness(node)
        : await adapters.readiness(db, actor, node, signal);
  }
  return result;
}
