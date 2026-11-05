import { z } from "zod";
import type { Db } from "@/db/client";
import type { BlockJson, BlockOutput } from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { nativeSnapshotVisible } from "./nativeEventVisibility";
import { type NativeFieldMetadata, nativeFieldCatalog, nativeObjectName } from "./nativeFields";
import { nativeColumnName } from "./nativeFilters";
import { type NativeRecord, readNativeTombstone, redactNativeReferences } from "./nativeRecords";
import { compatibleNativeValue } from "./nativeValues";

export interface NativeRecordEvent {
  entity: string;
  id: string;
  eventName: string;
  before: BlockOutput | null;
  after: BlockOutput | null;
  changedFields?: string[];
}

function snapshotRecord(
  raw: BlockOutput | null,
  fields: NativeFieldMetadata[],
  id: string,
): NativeRecord | null {
  if (raw === null) return null;
  const projected: NativeRecord = { id };
  for (const field of fields) {
    projected[field.key] = snapshotValue(raw, field);
  }
  return projected;
}

function snapshotRawValue(raw: BlockOutput, field: NativeFieldMetadata): BlockJson | undefined {
  let value: BlockJson | undefined;
  if (field.key.startsWith("customFields.")) {
    const custom = raw.custom_fields;
    if (custom !== null && typeof custom === "object" && !Array.isArray(custom))
      value = custom[field.key.slice(13)];
  } else {
    const column = nativeColumnName(field.key);
    if (column !== undefined) value = raw[column];
  }

  return value;
}

function snapshotValue(raw: BlockOutput, field: NativeFieldMetadata): BlockJson {
  return compatibleNativeValue(snapshotRawValue(raw, field), field);
}

// Raw outbox snapshots are internal only. Current persisted authorization gates the
// whole event, including soft-deleted rows. A missing dominant parent remains denied.
export async function projectNativeEvent(
  db: Db,
  actor: PermSetUser,
  event: NativeRecordEvent,
  signal: AbortSignal,
): Promise<BlockOutput | null> {
  if (!nativeObjectName(event.entity) || !z.uuid().safeParse(event.id).success || !actor.isActive)
    return null;
  if (
    !new Set([`${event.entity}.created`, `${event.entity}.updated`, `${event.entity}.deleted`]).has(
      event.eventName,
    )
  )
    return null;
  const record = await readNativeTombstone(db, actor, event.entity, event.id, signal);
  if (record === null) return null;
  const fields = await nativeFieldCatalog(db, actor, event.entity, signal);
  const before = snapshotRecord(event.before, fields, event.id);
  const after = snapshotRecord(event.after, fields, event.id);
  const beforeAllowed =
    event.before !== null &&
    (await nativeSnapshotVisible(db, actor, event.entity, event.before, signal));
  const afterAllowed =
    event.after !== null &&
    (await nativeSnapshotVisible(db, actor, event.entity, event.after, signal));
  const selected = event.eventName.endsWith(".deleted")
    ? beforeAllowed
      ? before
      : null
    : afterAllowed
      ? after
      : null;
  if (selected === null) return null;
  await redactNativeReferences(
    db,
    actor,
    [before, after].filter((value): value is NativeRecord => value !== null),
    fields,
    signal,
  );
  const changedFields = (event.changedFields ?? []).flatMap((column) => {
    if (column === "custom_fields")
      return fields
        .filter((field) => field.key.startsWith("customFields."))
        .map((field) => field.key);
    const field = fields.find((entry) => nativeColumnName(entry.key) === column);
    return field === undefined ? [] : [field.key];
  });
  return {
    recordId: event.id,
    record: selected,
    previousRecord: beforeAllowed ? before : null,
    eventName: event.eventName,
    changedFields,
  };
}
