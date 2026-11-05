import type { Db } from "@/db/client";
import { resolveBlockConfig } from "@/features/blocks/bindings";
import type {
  BlockJson,
  BlockOutput,
  BlockReadiness,
  WorkflowV2Node,
} from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import {
  type NativeFieldMetadata,
  type NativeObjectName,
  nativeFieldCatalog,
  nativeObjectName,
  nativeReferenceGate,
} from "./nativeFields";
import { compileNativeFilters, nativeFindSchema } from "./nativeFilters";
import { nativePickSchema } from "./nativePick";

const needs = (reason: string): BlockReadiness => ({ state: "needs_configuration", reason });
function object(value: unknown): value is BlockOutput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function filterShape(
  value: BlockJson | undefined,
  fields: NativeFieldMetadata[],
  depth = 0,
): boolean {
  if (value === undefined) return true;
  if (depth > 5) return false;
  if (Array.isArray(value))
    return value.length <= 30 && value.every((item) => filterShape(item, fields, depth + 1));
  if (!object(value)) return false;
  if (value.combinator !== undefined)
    return (
      (value.combinator === "and" || value.combinator === "or") &&
      Array.isArray(value.conditions) &&
      value.conditions.length > 0 &&
      filterShape(value.conditions, fields, depth + 1)
    );
  const field = fields.find((entry) => entry.key === value.field);
  return (
    field !== undefined &&
    typeof value.operator === "string" &&
    field.filterOperators.some((operator) => operator === value.operator)
  );
}

export function nativeFindReadiness(
  node: WorkflowV2Node,
  catalog: NativeFieldMetadata[],
): BlockReadiness {
  if (!filterShape(node.config.filters, catalog)) return needs("workflow_native_filter_invalid");
  const resolved = resolveBlockConfig(node.config, {}, [], {});
  if (resolved.ok) {
    const input = nativeFindSchema.parse(resolved.value);
    compileNativeFilters(input.filters, catalog);
  }
  const sort = node.config.sort;
  if (
    sort !== undefined &&
    (!object(sort) ||
      typeof sort.field !== "string" ||
      (sort.direction !== "asc" && sort.direction !== "desc"))
  )
    return needs("workflow_native_sort_invalid");
  const field = catalog.find((entry) => entry.key === (object(sort) ? sort.field : "id"));
  return field === undefined ||
    field.valueType === "array" ||
    field.valueType === "object" ||
    nativeReferenceGate(field.referenceObject) !== undefined
    ? needs("workflow_native_sort_invalid")
    : { state: "ready" };
}

export async function nativePickReadiness(
  db: Db,
  actor: PermSetUser,
  node: WorkflowV2Node,
  objectName: NativeObjectName,
  catalog: NativeFieldMetadata[],
  signal: AbortSignal,
): Promise<BlockReadiness> {
  const config = node.config;
  if (config.recordIds === undefined) return needs("workflow_native_candidates_required");
  if (
    typeof config.selectionMode !== "string" ||
    !["RANDOM", "ROUND_ROBIN", "LOAD_BALANCED"].includes(config.selectionMode)
  )
    return needs("workflow_native_selection_invalid");
  const resolved = resolveBlockConfig(config, {}, [], {});
  if (resolved.ok) nativePickSchema.parse(resolved.value);
  if (config.selectionMode !== "LOAD_BALANCED") return { state: "ready" };
  if ((config.loadField === undefined) === (config.loadRelation === undefined))
    return needs("workflow_native_load_configuration");
  if (config.loadField !== undefined)
    return catalog.some((field) => field.key === config.loadField && field.valueType === "number")
      ? { state: "ready" }
      : needs("workflow_native_load_configuration");
  const relation = config.loadRelation;
  if (
    !object(relation) ||
    !nativeObjectName(relation.objectName) ||
    typeof relation.field !== "string"
  )
    return needs("workflow_native_load_configuration");
  const relatedFields = await nativeFieldCatalog(db, actor, relation.objectName, signal);
  return relatedFields.some(
    (field) => field.key === relation.field && field.referenceObject === objectName,
  )
    ? { state: "ready" }
    : needs("workflow_native_load_configuration");
}
