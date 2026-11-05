import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { nativeError } from "./nativeErrors";
import { nativeFieldCatalog } from "./nativeFields";
import { nativeFieldJson } from "./nativeFilters";
import {
  findNativeRecords,
  type NativeRecord,
  nativeFrom,
  nativeVisibility,
} from "./nativeRecords";

export const nativePickSchema = z.strictObject({
  objectName: z.enum(["deal", "lead", "person", "organization", "activity"]),
  recordIds: z.array(z.uuid()).min(1).max(100),
  selectionMode: z.enum(["RANDOM", "ROUND_ROBIN", "LOAD_BALANCED"]),
  loadField: z.string().min(1).max(255).optional(),
  loadRelation: z
    .strictObject({
      objectName: z.enum(["deal", "lead", "person", "organization", "activity"]),
      field: z.string().min(1).max(255),
    })
    .optional(),
});

export function deterministicNativeIndex(effectKey: string, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1)
    throw nativeError("workflow_native_candidates_invalid");
  return createHash("sha256").update(effectKey).digest().readUInt32BE(0) % count;
}

export async function pickNativeRecord(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  effectKey: string,
  nextIndex: (count: number) => Promise<number>,
  signal: AbortSignal,
): Promise<NativeRecord | null> {
  const input = nativePickSchema.parse(raw);
  const ids = [...new Set(input.recordIds.map((id) => id.toLowerCase()))].sort();
  const records = await findNativeRecords(
    db,
    actor,
    {
      objectName: input.objectName,
      filters: [{ field: "id", operator: "in", value: ids }],
      limit: 100,
    },
    signal,
  );
  records.sort((a, b) => a.id.localeCompare(b.id));
  if (records.length === 0) return null;
  if (input.selectionMode === "RANDOM")
    return records[deterministicNativeIndex(effectKey, records.length)] ?? null;
  if (input.selectionMode === "ROUND_ROBIN") {
    const index = await nextIndex(records.length);
    if (!Number.isSafeInteger(index) || index < 0 || index >= records.length)
      throw nativeError("workflow_native_cursor_invalid");
    return records[index] ?? null;
  }
  const loads = await nativeLoads(db, actor, input, records, signal);
  records.sort((a, b) => {
    const left = loads.get(a.id);
    const right = loads.get(b.id);
    if (left === undefined || right === undefined)
      throw nativeError("workflow_native_load_unavailable");
    return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
  });
  signal.throwIfAborted();
  return records[0] ?? null;
}

async function nativeLoads(
  db: Db,
  actor: PermSetUser,
  input: z.infer<typeof nativePickSchema>,
  records: NativeRecord[],
  signal: AbortSignal,
): Promise<Map<string, bigint | number>> {
  if ((input.loadField === undefined) === (input.loadRelation === undefined))
    throw nativeError("workflow_native_load_configuration");
  const loads = new Map<string, bigint | number>();
  if (input.loadField !== undefined) {
    const metadata = await nativeFieldCatalog(db, actor, input.objectName, signal);
    if (!metadata.some((field) => field.key === input.loadField && field.valueType === "number"))
      throw nativeError("workflow_native_load_configuration");
    addNumericLoads(loads, records, input.loadField);
  } else if (input.loadRelation !== undefined) {
    const relation = input.loadRelation;
    const metadata = await nativeFieldCatalog(db, actor, relation.objectName, signal);
    const field = metadata.find(
      (entry) => entry.key === relation.field && entry.referenceObject === input.objectName,
    );
    if (field === undefined) throw nativeError("workflow_native_load_configuration");
    const counts = await db.execute<{ id: string; count: string }>(sql`
      SELECT ${nativeFieldJson(field)} #>> '{}' AS id,count(*)::text AS count FROM ${nativeFrom(relation.objectName)}
      WHERE r.deleted_at IS NULL AND ${nativeVisibility(actor, relation.objectName)}
        AND ${nativeFieldJson(field)} #>> '{}' IN (${sql.join(
          records.map((record) => sql`${record.id}`),
          sql`, `,
        )})
      GROUP BY ${nativeFieldJson(field)}
    `);
    for (const record of records) loads.set(record.id, 0n);
    for (const row of counts.rows) loads.set(row.id, BigInt(row.count));
  }

  return loads;
}

function addNumericLoads(
  loads: Map<string, bigint | number>,
  records: NativeRecord[],
  key: string,
): void {
  for (const record of records) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value))
      throw nativeError("workflow_native_load_unavailable");
    loads.set(record.id, value);
  }
}
