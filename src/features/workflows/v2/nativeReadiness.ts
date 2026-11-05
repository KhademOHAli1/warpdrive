import { z } from "zod";
import type { Db } from "@/db/client";
import { resolveBlockConfig } from "@/features/blocks/bindings";
import type {
  BlockJson,
  BlockOutput,
  BlockReadiness,
  WorkflowV2Node,
} from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { localWorkflowAction } from "./localActions";
import { localWorkflowReadiness } from "./localReadiness";
import {
  type NativeFieldMetadata,
  type NativeObjectName,
  nativeFieldCatalog,
  nativeObjectName,
} from "./nativeFields";
import {
  nativeMutationCapability,
  nativeRecordMutationAllowed,
  nativeReferenceAllowed,
} from "./nativePermissions";
import { nativeFindReadiness, nativePickReadiness } from "./nativeReadinessQueries";
import { nativeFieldsSchema, nativeWriteFields } from "./nativeWrites";

interface Context {
  db: Db;
  actor: PermSetUser;
  node: WorkflowV2Node;
  objectName: NativeObjectName;
  catalog: NativeFieldMetadata[];
  signal: AbortSignal;
}
function object(value: unknown): value is BlockOutput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function literal(value: BlockJson | undefined): BlockJson | undefined {
  if (value === undefined) return undefined;
  const result = resolveBlockConfig({ value }, {}, [], {});
  return result.ok ? result.value.value : undefined;
}
const needs = (reason: string): BlockReadiness => ({ state: "needs_configuration", reason });
const ready: BlockReadiness = { state: "ready" };

async function recordReadiness(context: Context): Promise<BlockReadiness> {
  const { db, actor, node, objectName, signal } = context;
  if (node.type !== "UPDATE_RECORD" && node.type !== "DELETE_RECORD") return ready;
  if (node.config.recordId === undefined) return needs("workflow_native_record_required");
  const recordId = literal(node.config.recordId);
  if (recordId === undefined) return ready;
  const parsed = z.uuid().safeParse(recordId);
  if (!parsed.success) return needs("workflow_native_record_invalid");
  const allowed = await nativeRecordMutationAllowed(
    db,
    actor,
    objectName,
    parsed.data,
    node.type === "DELETE_RECORD" ? "delete" : "update",
    signal,
  );
  return allowed ? ready : { state: "forbidden", reason: "workflow_native_record_unavailable" };
}

async function fieldsReadiness(context: Context): Promise<BlockReadiness> {
  const { db, actor, node, catalog, signal } = context;
  const fields = node.config.fields;
  if (!object(fields) || typeof fields.kind === "string")
    return needs("workflow_native_fields_required");
  const create =
    node.type === "CREATE_RECORD" ||
    (node.type === "UPSERT_RECORD" && node.config.matchField !== "id");
  for (const [key, binding] of Object.entries(fields)) {
    const field = catalog.find((entry) => entry.key === key);
    if (field === undefined) return needs("workflow_native_field_not_writable");
    if (!(create ? field.createable : field.updateable))
      return needs("workflow_native_field_not_writable");
    const value = literal(binding);
    if (value !== undefined && !(await nativeReferenceAllowed(db, actor, field, value, signal)))
      return { state: "forbidden", reason: "workflow_native_reference_unavailable" };
  }
  if (
    node.type === "CREATE_RECORD" &&
    catalog.some((field) => field.required && field.createable && fields[field.key] === undefined)
  )
    return needs("workflow_native_required_field");
  return literalFieldsReadiness(context);
}

async function literalFieldsReadiness(context: Context): Promise<BlockReadiness> {
  const { db, actor, node, objectName, signal } = context;
  const resolved = resolveBlockConfig(node.config, {}, [], {});
  if (!resolved.ok || !object(resolved.value.fields) || node.type === "UPSERT_RECORD") return ready;
  const mode = node.type === "CREATE_RECORD" ? "create" : "update";
  const fields = await nativeWriteFields(
    db,
    actor,
    objectName,
    resolved.value.fields,
    mode,
    signal,
  );
  const recordId = literal(node.config.recordId);
  const identity =
    objectName === "deal"
      ? { dealId: recordId }
      : objectName === "lead"
        ? { leadId: recordId }
        : { id: recordId };
  const input =
    mode === "create"
      ? fields
      : { ...fields, ...identity, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" };
  return nativeFieldsSchema(objectName, mode).safeParse(input).success
    ? ready
    : needs("workflow_native_fields_invalid");
}

async function mutationReadiness(context: Context): Promise<BlockReadiness> {
  const { actor, node, objectName, catalog } = context;
  const mode =
    node.type === "CREATE_RECORD" ? "create" : node.type === "DELETE_RECORD" ? "delete" : "update";
  if (!nativeMutationCapability(actor, objectName, mode))
    return { state: "forbidden", reason: "E_PERM_001" };
  const record = await recordReadiness(context);
  if (record.state !== "ready" || node.type === "DELETE_RECORD") return record;
  if (node.type === "UPSERT_RECORD") {
    if (node.config.matchValue === undefined) return needs("workflow_native_identity_invalid");
    if (
      !catalog.some(
        (field) => field.key === node.config.matchField && field.upsertIdentity === true,
      )
    )
      return needs("workflow_native_identity_invalid");
  }
  return fieldsReadiness(context);
}

export async function nativeActionReadiness(
  db: Db,
  actor: PermSetUser,
  node: WorkflowV2Node,
  signal: AbortSignal,
): Promise<BlockReadiness> {
  if (localWorkflowAction(node.type)) return localWorkflowReadiness(db, actor, node, signal);
  if (!nativeObjectName(node.config.objectName)) return needs("workflow_native_object_invalid");
  if (!actor.isActive) return { state: "forbidden", reason: "E_PERM_001" };
  const objectName = node.config.objectName;
  try {
    const catalog = await nativeFieldCatalog(db, actor, objectName, signal);
    if (node.type === "FIND_RECORDS") return nativeFindReadiness(node, catalog);
    if (node.type === "PICK_RECORD")
      return await nativePickReadiness(db, actor, node, objectName, catalog, signal);
    return await mutationReadiness({ db, actor, node, objectName, catalog, signal });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return needs("workflow_native_configuration_invalid");
  }
}
