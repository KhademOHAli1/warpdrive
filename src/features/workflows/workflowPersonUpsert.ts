import { createHash } from "node:crypto";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { loadContactActor, toRefActor } from "@/features/contacts/actorAdapters";
import { joinName, splitName } from "@/features/contacts/personName";
import { createPersonAtId } from "@/features/contacts/personsRepo";
import { type PersonCreateInput, personCreateInput } from "@/features/contacts/schemas";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs } from "./runTypes";
import type { Binding, WorkflowDefinition } from "./schemas";
import {
  type WorkflowPersonUpsertConfig,
  type WorkflowPersonUpsertValues,
  workflowPersonUpsertConfig,
  workflowPersonUpsertFields,
  workflowPersonUpsertValues,
} from "./workflowPersonUpsertContract";
import { type RecordCreateMode, withRecordWriteTransaction } from "./workflowRecordCreate";
import { mutateNativeRecord, type RecordUpdatePatch } from "./workflowRecordMutationNative";

export interface WorkflowPersonUpsertScope {
  workflowId: string;
  mode: RecordCreateMode;
}

function personId(workflowId: string, key: string): string {
  // The caller never supplies a Person ID. All versions/runs of one workflow
  // share this identity namespace; a copied workflow has a different namespace.
  const bytes = createHash("sha256")
    .update(JSON.stringify(["warpdrive:workflow-person-upsert:v1", workflowId.toLowerCase(), key]))
    .digest()
    .subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x80, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function resolvedBinding(
  binding: Binding,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  nodeId: string,
  path: readonly string[],
) {
  if (binding.kind === "value") return ok(binding.value);
  const resolved = resolveRunBinding(binding, outputs, { definition, nodeId, path });
  switch (resolved.state) {
    case "invalid":
      return err(ERROR_IDS.WORKFLOW_INVALID);
    case "missing":
      return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
    case "null":
      return ok(null);
    case "value":
      return ok(resolved.value);
  }
}

function resolveFields(
  config: WorkflowPersonUpsertConfig,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  nodeId: string,
) {
  const key = resolvedBinding(config.key, outputs, definition, nodeId, ["key"]);
  if (!key.ok) return key;
  const fields: Record<string, unknown> = {};
  for (const field of workflowPersonUpsertFields) {
    const binding = config.fields[field];
    if (binding === undefined) continue;
    const value = resolvedBinding(binding, outputs, definition, nodeId, ["fields", field]);
    if (!value.ok) return value;
    fields[field] = value.value;
  }
  const parsed = workflowPersonUpsertValues.safeParse({ key: key.value, fields });
  return parsed.success ? ok(parsed.data) : err(ERROR_IDS.WORKFLOW_INVALID);
}

function personPatch(fields: WorkflowPersonUpsertValues["fields"]): RecordUpdatePatch {
  if (fields.firstName === undefined && fields.lastName === undefined) return fields;
  const defaults = splitName(fields.name);
  const firstName = fields.firstName ?? defaults.firstName;
  const lastName = fields.lastName ?? defaults.lastName ?? "";
  // Supply both parts to each native command, so their name precedence agrees.
  return { ...fields, name: joinName({ firstName, lastName }), firstName, lastName };
}

async function writePerson(
  tx: Db,
  actor: PermSetUser,
  id: string,
  patch: RecordUpdatePatch,
  input: PersonCreateInput,
  signal: AbortSignal,
) {
  const current = await hydrateActor(tx, actor.id, signal);
  if (current === null) return err(ERROR_IDS.PERM_DENIED);
  const visible = await assertReferenceVisible(
    tx,
    toRefActor(current),
    { kind: "person", id },
    signal,
  );
  const update = () => mutateNativeRecord(tx, "person", { actor: current, id, patch, signal });
  if (visible.ok) return update();
  if (visible.error.id !== ERROR_IDS.CONTACT_NOT_FOUND) return err(visible.error.id);
  if (!can(current, "contact.create")) return err(ERROR_IDS.PERM_DENIED);

  const contact = {
    ...(await loadContactActor(tx, current, signal)),
    managedUserIds: current.managedUserIds,
  };
  const saved = await createPersonAtId(tx, contact, input, id, signal);
  signal.throwIfAborted();
  if (!saved.ok) return err(saved.error.id);
  // Concurrent inserts converge on the same PK. A hidden or deleted collision
  // fails through the native locked update, and never becomes another insert.
  return saved.value === null ? update() : ok({ id: saved.value.id });
}

export async function upsertWorkflowPerson(
  tx: Db,
  actor: PermSetUser,
  node: { id: string; version: number; config: unknown },
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  scope: WorkflowPersonUpsertScope,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (node.version !== 1) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (!("rollback" in tx)) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  if (!z.uuid().safeParse(scope.workflowId).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const config = workflowPersonUpsertConfig.safeParse(node.config);
  if (!config.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const fields = resolveFields(config.data, outputs, definition, node.id);
  if (!fields.ok) return fields;
  const patch = personPatch(fields.value.fields);
  const input = personCreateInput.safeParse(patch);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const id = personId(scope.workflowId, fields.value.key);
  return withRecordWriteTransaction(tx, scope.mode, signal, (work) =>
    writePerson(work, actor, id, patch, input.data, signal),
  );
}
