import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { resolveRunBinding, uuidBinding } from "./runBindings";
import type { RunOutputs } from "./runTypes";
import { nodeSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";
import { type RecordCreateMode, withRecordWriteTransaction } from "./workflowRecordCreate";
import {
  type RecordUpdateConfig,
  recordDeleteConfig,
  recordUpdateConfig,
  recordUpdateFields,
} from "./workflowRecordMutationContract";
import {
  mutateNativeRecord,
  type RecordMutationResult,
  type RecordUpdatePatch,
} from "./workflowRecordMutationNative";

function resolvePatch(
  config: RecordUpdateConfig,
  definition: WorkflowDefinition,
  nodeId: string,
  outputs: RunOutputs,
): Result<RecordUpdatePatch, string> {
  const patch: RecordUpdatePatch = {};
  for (const field of recordUpdateFields[config.entity]) {
    const binding = config.fields[field.key];
    if (binding === undefined) continue;
    const value = resolveRunBinding(binding, outputs, {
      definition,
      nodeId,
      path: ["fields", field.key],
    });
    if (value.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
    if (value.state === "missing") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
    if (value.state === "null") {
      if (!field.nullable) return err(ERROR_IDS.WORKFLOW_INVALID);
      patch[field.key] = null;
      continue;
    }
    const parsed = field.schema.safeParse(value.value);
    if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
    patch[field.key] = parsed.data;
  }
  return ok(patch);
}

function parseMutationConfig(node: WorkflowNode) {
  if (node.type === "record.update") {
    const parsed = recordUpdateConfig.safeParse(node.config);
    return parsed.success ? { kind: "update" as const, config: parsed.data } : null;
  }
  const parsed = recordDeleteConfig.safeParse(node.config);
  return parsed.success ? { kind: "delete" as const, config: parsed.data } : null;
}

function prepare(node: WorkflowNode, outputs: RunOutputs, definition: WorkflowDefinition) {
  const parsed = parseMutationConfig(node);
  if (parsed === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  const record = uuidBinding(parsed.config.recordId, outputs, {
    definition,
    nodeId: node.id,
    path: ["recordId"],
  });
  if (!record.ok) return record;
  const patch =
    parsed.kind === "update" ? resolvePatch(parsed.config, definition, node.id, outputs) : ok(null);
  return patch.ok
    ? ok({ entity: parsed.config.entity, id: record.value, patch: patch.value })
    : patch;
}

export async function mutateWorkflowRecord(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  mode: RecordCreateMode,
  signal: AbortSignal,
): Promise<RecordMutationResult> {
  signal.throwIfAborted();
  if (
    (node.type !== "record.update" && node.type !== "record.delete") ||
    !nodeSchema.shape.version.safeParse(node.version).success
  )
    return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const target = prepare(node, outputs, definition);
  if (!target.ok) return target;

  return withRecordWriteTransaction(db, mode, signal, (tx) =>
    mutateNativeRecord(tx, target.value.entity, {
      actor,
      id: target.value.id,
      patch: target.value.patch,
      signal,
    }),
  );
}
