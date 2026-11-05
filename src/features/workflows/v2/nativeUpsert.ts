import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { derivePrimaryEmail } from "@/features/contacts/primaryEmail";
import { emailPointSchema } from "@/features/contacts/schemas";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import {
  type NativeFieldMetadata,
  type NativeObjectName,
  nativeFieldCatalog,
} from "./nativeFields";
import type { NativeJson } from "./nativeFilters";
import { nativeRecordMutationAllowed } from "./nativePermissions";
import { nativeFrom, readNativeRecord } from "./nativeRecords";
import { createNativeRecord, updateNativeRecord } from "./nativeWrites";

export const nativeUpsertSchema = z.strictObject({
  objectName: z.enum(["deal", "lead", "person", "organization", "activity"]),
  matchField: z.string().min(1).max(255),
  matchValue: z.union([z.string().min(1).max(255), z.number().finite()]),
  fields: z.record(z.string(), z.json()),
});

// This lock serializes cooperating workflow writers. It does not create a natural-key
// uniqueness guarantee for unrelated app writes; ambiguous identities fail closed.
export async function upsertNativeRecord(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
): Promise<Result<{ id: string; created: boolean }, string>> {
  const input = nativeUpsertSchema.parse(raw);
  const fields = await nativeFieldCatalog(db, actor, input.objectName, signal);
  const identity = fields.find(
    (field) => field.key === input.matchField && field.upsertIdentity === true,
  );
  if (identity === undefined || typeof input.matchValue !== identity.valueType)
    return err("workflow_native_identity_invalid");
  if (identity.key === "id") z.uuid().parse(input.matchValue);
  const value =
    identity.key === "primaryEmail"
      ? String(input.matchValue).trim().toLowerCase()
      : input.matchValue;
  if (!identityFieldsAgree(input.fields, identity.key, value))
    return err("workflow_native_identity_invalid");
  const lockKey = JSON.stringify([input.objectName, identity.key, value]);
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))`);
  const match =
    identity.key === "id"
      ? sql`r.id=${value}::uuid`
      : identity.key === "primaryEmail"
        ? sql`r.primary_email=${value}::citext`
        : sql`r.custom_fields @> ${JSON.stringify({ [identity.key.slice(13)]: value })}::jsonb`;
  const rows = await db.execute<{ id: string }>(sql`SELECT r.id FROM ${nativeFrom(input.objectName)}
    WHERE r.deleted_at IS NULL AND ${match} ORDER BY r.id LIMIT 2`);
  signal.throwIfAborted();
  if (rows.rows.length > 1) return err("workflow_native_identity_unresolvable");
  const found = rows.rows[0];
  if (found !== undefined)
    return updateExisting(db, actor, input.objectName, found.id, input.fields, fields, signal);

  return createMissing(db, actor, input.objectName, identity.key, value, input.fields, signal);
}

function identityFieldsAgree(
  fields: Record<string, NativeJson>,
  key: string,
  value: string | number,
): boolean {
  const supplied = fields[key];
  if (supplied !== undefined && supplied !== value) return false;
  if (key !== "primaryEmail" || fields.emails === undefined) return true;
  const emails = z.array(emailPointSchema).safeParse(fields.emails);
  return emails.success && derivePrimaryEmail(emails.data)?.toLowerCase() === value;
}
async function updateExisting(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  id: string,
  rawFields: Record<string, NativeJson>,
  fields: NativeFieldMetadata[],
  signal: AbortSignal,
): Promise<Result<{ id: string; created: boolean }, string>> {
  const current = await readNativeRecord(db, actor, objectName, id, signal);
  if (current === null) return err("workflow_native_identity_unresolvable");
  if (!(await nativeRecordMutationAllowed(db, actor, objectName, id, "update", signal)))
    return err("E_PERM_001");
  const updateFields: Record<string, NativeJson> = {};
  for (const [key, fieldValue] of Object.entries(rawFields)) {
    if (fields.some((field) => field.key === key && field.updateable))
      updateFields[key] = fieldValue;
    else if (
      !fields.some((field) => field.key === key && field.createable) ||
      JSON.stringify(current[key]) !== JSON.stringify(fieldValue)
    )
      return err("workflow_native_field_not_writable");
  }
  if (Object.keys(updateFields).length === 0) return ok({ id: id, created: false });
  const updated = await updateNativeRecord(db, actor, objectName, id, updateFields, signal);
  return updated.ok ? ok({ id: updated.value.id, created: false }) : updated;
}
async function createMissing(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  identityKey: string,
  value: string | number,
  rawFields: Record<string, NativeJson>,
  signal: AbortSignal,
): Promise<Result<{ id: string; created: boolean }, string>> {
  if (identityKey === "id") return err("workflow_native_identity_unresolvable");
  const createFields: Record<string, NativeJson> = { ...rawFields };
  if (identityKey === "primaryEmail") {
    const emails = z.array(emailPointSchema).safeParse(createFields.emails);
    if (!emails.success || derivePrimaryEmail(emails.data)?.toLowerCase() !== value)
      return err("workflow_native_identity_invalid");
  } else {
    const supplied = createFields[identityKey];
    if (supplied !== undefined && supplied !== value)
      return err("workflow_native_identity_invalid");
    createFields[identityKey] = value;
  }
  const created = await createNativeRecord(db, actor, objectName, createFields, signal);
  return created.ok ? ok({ id: created.value.id, created: true }) : created;
}
