import { z } from "zod";
import type { Db } from "@/db/client";
import type {
  BlockOutput,
  NativeActionExecutor,
  WorkflowV2Node,
} from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { executeLocalWorkflowAction, localWorkflowAction } from "./localActions";
import { type NativeObjectName, nativeObjectName } from "./nativeFields";
import { nativeFindSchema } from "./nativeFilters";
import { pickNativeRecord } from "./nativePick";
import { findNativeRecords, readNativeRecord } from "./nativeRecords";
import { upsertNativeRecord } from "./nativeUpsert";
import { createNativeRecord, deleteNativeRecord, updateNativeRecord } from "./nativeWrites";

export { nativeActionReadiness } from "./nativeReadiness";

const fieldsSchema = z.record(z.string().min(1).max(255), z.json());

export const executeNativeAction: NativeActionExecutor = async (tx, args) => {
  const { actor, node, resolvedConfig: config, signal } = args;
  signal.throwIfAborted();
  if (!actor.isActive) return err("E_PERM_001");
  try {
    if (localWorkflowAction(node.type)) return await executeLocalWorkflowAction(tx, args);
    if (!nativeObjectName(config.objectName)) return err("workflow_native_object_invalid");
    const objectName = config.objectName;
    if (node.type === "FIND_RECORDS") {
      const records = await findNativeRecords(tx, actor, nativeFindSchema.parse(config), signal);
      return ok({ records, count: records.length });
    }
    if (node.type === "PICK_RECORD") {
      const record = await pickNativeRecord(
        tx,
        actor,
        config,
        args.effectKey,
        (count) => args.nextPickIndex(node.id, count),
        signal,
      );
      return ok({ record, recordId: record?.id ?? null, found: record !== null });
    }
    return await executeMutation(tx, actor, node, config, objectName, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err(
      error instanceof Error && error.message.startsWith("workflow_native_")
        ? error.message
        : "workflow_native_action_invalid",
    );
  }
};

async function executeMutation(
  tx: Db,
  actor: PermSetUser,
  node: WorkflowV2Node,
  config: BlockOutput,
  objectName: NativeObjectName,
  signal: AbortSignal,
): Promise<Result<BlockOutput, string>> {
  if (node.type === "DELETE_RECORD") {
    const id = z.uuid().parse(config.recordId);
    const removed = await deleteNativeRecord(tx, actor, objectName, id, signal);
    return removed.ok ? ok({ recordId: removed.value.id, deleted: true }) : removed;
  }
  const fields = fieldsSchema.parse(config.fields);
  if (node.type === "UPSERT_RECORD") {
    const upserted = await upsertNativeRecord(tx, actor, { ...config, fields }, signal);
    return upserted.ok
      ? mutationOutput(tx, actor, objectName, upserted.value.id, signal, {
          created: upserted.value.created,
          updated: !upserted.value.created,
        })
      : upserted;
  }
  const result =
    node.type === "CREATE_RECORD"
      ? await createNativeRecord(tx, actor, objectName, fields, signal)
      : node.type === "UPDATE_RECORD"
        ? await updateNativeRecord(
            tx,
            actor,
            objectName,
            z.uuid().parse(config.recordId),
            fields,
            signal,
          )
        : err("workflow_native_action_unsupported");
  return result.ok
    ? mutationOutput(tx, actor, objectName, result.value.id, signal, {
        created: node.type === "CREATE_RECORD",
        updated: node.type === "UPDATE_RECORD",
      })
    : result;
}

async function mutationOutput(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  id: string,
  signal: AbortSignal,
  flags: BlockOutput,
): Promise<Result<BlockOutput, string>> {
  const record = await readNativeRecord(db, actor, objectName, id, signal);
  return ok({ ...flags, record, recordId: record?.id ?? null });
}

export function nativeActionNode(type: WorkflowV2Node["type"]): boolean {
  return (
    localWorkflowAction(type) ||
    [
      "CREATE_RECORD",
      "UPDATE_RECORD",
      "DELETE_RECORD",
      "UPSERT_RECORD",
      "FIND_RECORDS",
      "PICK_RECORD",
    ].includes(type)
  );
}
