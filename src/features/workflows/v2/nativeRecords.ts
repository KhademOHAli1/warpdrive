import { type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { toRefActor } from "@/features/contacts/actorAdapters";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import { activityVisibilityPredicate } from "@/features/stats/activityVisibilitySql";
import { nativeError } from "./nativeErrors";
import {
  type NativeFieldMetadata,
  type NativeObjectName,
  nativeFieldCatalog,
  nativeReferenceGate,
} from "./nativeFields";
import {
  compileNativeFilters,
  type NativeFindInput,
  type NativeJson,
  nativeFieldJson,
  nativeFieldScalar,
  nativeFindSchema,
} from "./nativeFilters";
import { assertNativeFilterReferences } from "./nativeReferenceFilters";
import { compatibleNativeValue } from "./nativeValues";

export type NativeRecord = Record<string, NativeJson> & { id: string };
const tables: Record<NativeObjectName, string> = {
  deal: "deals",
  lead: "leads",
  person: "persons",
  organization: "organizations",
  activity: "activities",
};
export function nativeFrom(objectName: NativeObjectName): SQL {
  return objectName === "deal"
    ? sql`deals r JOIN pipelines p ON p.id=r.pipeline_id`
    : sql`${sql.identifier(tables[objectName])} r`;
}

export function nativeVisibility(actor: PermSetUser, objectName: NativeObjectName): SQL {
  if (!actor.isActive) return sql`FALSE`;
  if (objectName === "activity") return activityVisibilityPredicate(actor, "r");
  const visible = dealVisibilityPredicate(
    {
      userId: actor.id,
      isAdmin: actor.type === "admin",
      isActive: actor.isActive,
      sessionLive: true,
      groupIds: [...actor.groupIds],
      managedUserIds: [...(actor.managedUserIds ?? [])],
    },
    {
      ownerId: sql`r.owner_id`,
      visibilityLevel: sql`r.visibility_level`,
      visibilityGroupId: sql`r.visibility_group_id`,
      visibleToUserIds: sql`r.visible_to_user_ids`,
      pipelineVisibilityGroupId:
        objectName === "deal" ? sql`p.visibility_group_id` : sql`NULL::uuid`,
    },
  );
  return objectName === "deal" ? sql`(p.is_archived=false AND ${visible})` : visible;
}

export async function redactNativeReferences(
  db: Db,
  actor: PermSetUser,
  records: NativeRecord[],
  fields: NativeFieldMetadata[],
  signal: AbortSignal,
) {
  const cache = new Map<string, boolean>();
  for (const record of records) {
    for (const field of fields) {
      const kind = field.referenceObject;
      const value = record[field.key];
      if (
        (kind !== "deal" &&
          kind !== "lead" &&
          kind !== "person" &&
          kind !== "organization" &&
          kind !== "user") ||
        typeof value !== "string"
      )
        continue;
      const cacheKey = `${kind}:${value}`;
      let visible = cache.get(cacheKey);
      if (visible === undefined) {
        visible = (await assertReferenceVisible(db, toRefActor(actor), { kind, id: value }, signal))
          .ok;
        cache.set(cacheKey, visible);
      }
      if (!visible) record[field.key] = null;
    }
  }
}

async function queryNativeRecords(
  db: Db,
  actor: PermSetUser,
  raw: NativeFindInput,
  signal: AbortSignal,
  includeDeleted: boolean,
): Promise<NativeRecord[]> {
  signal.throwIfAborted();
  const input = nativeFindSchema.parse(raw);
  const fields = await nativeFieldCatalog(db, actor, input.objectName, signal);
  if (fields.length === 0) return [];
  const filter = compileNativeFilters(input.filters, fields);
  await assertNativeFilterReferences(db, actor, input.filters, fields, signal);
  const sort = fields.find((field) => field.key === (input.sort?.field ?? "id"));
  if (
    sort?.readable !== true ||
    sort.valueType === "array" ||
    sort.valueType === "object" ||
    nativeReferenceGate(sort.referenceObject) !== undefined
  )
    throw nativeError("workflow_native_sort_invalid");
  const projection = sql`(SELECT jsonb_object_agg(f.key,f.value) FROM (VALUES ${sql.join(
    fields.map((field) => sql`(${field.key}::text,${nativeFieldJson(field)})`),
    sql`, `,
  )}) AS f(key,value))`;
  const direction = input.sort?.direction === "desc" ? sql`DESC` : sql`ASC`;
  const result = await db.execute<{ record: NativeRecord }>(sql`
    SELECT ${projection} AS record FROM ${nativeFrom(input.objectName)}
    WHERE ${includeDeleted ? sql`TRUE` : sql`r.deleted_at IS NULL`} AND ${nativeVisibility(actor, input.objectName)} AND ${filter}
    ORDER BY ${nativeFieldScalar(sort)} ${direction} NULLS LAST,r.id ASC LIMIT ${input.limit} OFFSET ${input.offset}
  `);
  signal.throwIfAborted();
  const records = result.rows.map(({ record }) => record);
  for (const record of records)
    for (const field of fields) {
      record[field.key] = compatibleNativeValue(record[field.key], field);
    }
  await redactNativeReferences(db, actor, records, fields, signal);
  return records;
}

export async function findNativeRecords(
  db: Db,
  actor: PermSetUser,
  raw: NativeFindInput,
  signal: AbortSignal,
): Promise<NativeRecord[]> {
  return queryNativeRecords(db, actor, raw, signal, false);
}

export async function readNativeTombstone(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  id: string,
  signal: AbortSignal,
): Promise<NativeRecord | null> {
  const records = await queryNativeRecords(
    db,
    actor,
    { objectName, filters: [{ field: "id", operator: "eq", value: id }], limit: 1 },
    signal,
    true,
  );
  return records[0] ?? null;
}

// Only the mutation adapter consumes this unredacted custom-field state, under the
// same visibility gate and a row lock. It never becomes a workflow output or picker DTO.
export async function lockNativeRecordForWrite(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  id: string,
  signal: AbortSignal,
): Promise<NativeRecord | null> {
  const locked = await db.execute<{ custom_fields: Record<string, NativeJson> }>(sql`
    SELECT r.custom_fields FROM ${nativeFrom(objectName)} WHERE r.id=${id}::uuid
      AND r.deleted_at IS NULL AND ${nativeVisibility(actor, objectName)} FOR UPDATE OF r
  `);
  signal.throwIfAborted();
  const state = locked.rows[0];
  if (state === undefined) return null;
  const record = await readNativeRecord(db, actor, objectName, id, signal);
  if (record === null) return null;
  for (const [key, value] of Object.entries(state.custom_fields))
    record[`customFields.${key}`] = value;
  return record;
}

export async function readNativeRecord(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  id: string,
  signal: AbortSignal,
): Promise<NativeRecord | null> {
  const result = await findNativeRecords(
    db,
    actor,
    { objectName, filters: [{ field: "id", operator: "eq", value: id }], limit: 1 },
    signal,
  );
  return result[0] ?? null;
}
