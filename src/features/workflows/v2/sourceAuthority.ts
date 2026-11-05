import type { Db } from "@/db/client";
import { blockReferences, resolveBlockConfig } from "@/features/blocks/bindings";
import type {
  BlockJson,
  BlockOutput,
  NativeEntity,
  WorkflowV2Definition,
  WorkflowV2Node,
  WorkflowV2RunState,
} from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { nativeFieldCatalog, nativeObjectName } from "./nativeFields";
import {
  findNativeRecords,
  type NativeRecord,
  readNativeTombstone,
  redactNativeReferences,
} from "./nativeRecords";

interface Snapshot {
  objectName: NativeEntity;
  rows: NativeRecord[];
  tombstone: boolean;
}
const recordActions = new Set([
  "CREATE_RECORD",
  "UPDATE_RECORD",
  "UPSERT_RECORD",
  "FIND_RECORDS",
  "PICK_RECORD",
]);
function object(value: BlockJson | undefined): value is BlockOutput {
  return (
    value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
  );
}
function record(value: BlockJson | undefined): value is NativeRecord {
  return object(value) && typeof value.id === "string";
}
function records(output: BlockOutput) {
  return [
    output.record,
    output.previousRecord,
    ...(Array.isArray(output.records) ? output.records : []),
  ].filter(record);
}
function eventSnapshot(output: BlockOutput): Snapshot | null {
  if (typeof output.eventName !== "string") return null;
  const entity = output.eventName.split(".")[0];
  return nativeObjectName(entity)
    ? {
        objectName: entity,
        rows: records(output),
        tombstone: output.eventName.endsWith(".deleted"),
      }
    : null;
}
function sourceSnapshot(
  node: WorkflowV2Node | undefined,
  output: BlockOutput,
  definition: WorkflowV2Definition,
): Snapshot | null {
  if (
    node?.type === "WAIT_FOR_EVENT" ||
    (node === undefined && definition.trigger.type.startsWith("record."))
  )
    return eventSnapshot(output);
  if (node === undefined) {
    const launch = definition.trigger.config;
    return definition.trigger.type === "manual" &&
      (launch.availability === "single" || launch.availability === "bulk") &&
      nativeObjectName(launch.objectName)
      ? { objectName: launch.objectName, rows: records(output), tombstone: false }
      : null;
  }
  return recordActions.has(node.type) && nativeObjectName(node.config.objectName)
    ? { objectName: node.config.objectName, rows: records(output), tombstone: false }
    : null;
}
function referenceRoots(definition: WorkflowV2Definition, node: WorkflowV2Node): string[] {
  const nodes = new Map(definition.nodes.map((row) => [row.id, row]));
  const parents = new Map(definition.edges.map((edge) => [edge.target, edge.source]));
  const refs = blockReferences(node.config).map((ref) => ref.nodeId);
  let current = parents.get(node.id);
  while (current !== undefined) {
    const parent = nodes.get(current);
    if (parent !== undefined && ["FILTER", "IF_ELSE", "ITERATOR"].includes(parent.type))
      refs.push(...blockReferences(parent.config).map((ref) => ref.nodeId));
    current = parents.get(current);
  }
  return refs;
}
function snapshots(
  definition: WorkflowV2Definition,
  node: WorkflowV2Node,
  state: WorkflowV2RunState,
  framePath: string[],
  trigger: BlockOutput,
): Snapshot[] {
  const results: Snapshot[] = [];
  const seen = new Set<string>();
  const pending = referenceRoots(definition, node);
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const source = id === "$trigger" ? undefined : definition.nodes.find((row) => row.id === id);
    if (source !== undefined)
      pending.push(...blockReferences(source.config).map((ref) => ref.nodeId));
    const output = resolveBlockConfig(
      { data: { kind: "reference", nodeId: id, path: [] } },
      state.outputs,
      framePath,
      trigger,
    );
    if (!output.ok || !object(output.value.data)) continue;
    const snapshot = sourceSnapshot(source, output.value.data, definition);
    if (snapshot !== null && snapshot.rows.length > 0) results.push(snapshot);
  }
  return results;
}
async function verifySnapshot(db: Db, actor: PermSetUser, snapshot: Snapshot, signal: AbortSignal) {
  const ids = [...new Set(snapshot.rows.map((row) => row.id))];
  if (ids.length > 100) return false;
  if (snapshot.tombstone) {
    for (const id of ids)
      if ((await readNativeTombstone(db, actor, snapshot.objectName, id, signal)) === null)
        return false;
  } else {
    const visible = await findNativeRecords(
      db,
      actor,
      {
        objectName: snapshot.objectName,
        filters: [{ field: "id", operator: "in", value: ids }],
        limit: 100,
      },
      signal,
    );
    if (visible.length !== ids.length) return false;
  }
  const fields = await nativeFieldCatalog(db, actor, snapshot.objectName, signal);
  const currentKeys = new Set(fields.map((field) => field.key));
  currentKeys.add("id");
  if (snapshot.rows.some((row) => Object.keys(row).some((key) => !currentKeys.has(key))))
    return false;
  const copies = structuredClone(snapshot.rows);
  await redactNativeReferences(db, actor, copies, fields, signal);
  return JSON.stringify(copies) === JSON.stringify(snapshot.rows);
}
// Runs retain pinned source values; access to those values is rechecked before each new effect.
export async function boundSourcesVisible(
  db: Db,
  actor: PermSetUser,
  definition: WorkflowV2Definition,
  node: WorkflowV2Node,
  state: WorkflowV2RunState,
  framePath: string[],
  trigger: BlockOutput,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const sources = snapshots(definition, node, state, framePath, trigger);
    if (sources.length > 20) return false;
    for (const source of sources) {
      signal.throwIfAborted();
      if (!(await verifySnapshot(db, actor, source, signal))) return false;
    }
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}
