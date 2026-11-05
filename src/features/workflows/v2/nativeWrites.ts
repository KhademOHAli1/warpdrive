import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { deleteActivity } from "@/features/activities/activityDelete";
import { updateActivity } from "@/features/activities/activityUpdate";
import { createActivity } from "@/features/activities/repo";
import { activityCreateInput, activityUpdateInput } from "@/features/activities/schemas";
import { deleteOrg } from "@/features/contacts/deleteOrg";
import { deletePerson } from "@/features/contacts/deletePerson";
import { createOrg, updateOrg } from "@/features/contacts/orgsRepo";
import { type ContactActor, createPerson, updatePerson } from "@/features/contacts/personsRepo";
import {
  orgCreateInput,
  orgUpdateInput,
  personCreateInput,
  personUpdateInput,
} from "@/features/contacts/schemas";
import { createDeal, updateDeal } from "@/features/deals/dealActions";
import { deleteDeal } from "@/features/deals/deleteDeal";
import { dealCreateInput, dealUpdateInput } from "@/features/deals/schemas";
import { createLead } from "@/features/leads/leadActions";
import { bulkUpdateLeads } from "@/features/leads/leadBulk";
import { updateLead } from "@/features/leads/leadUpdate";
import { leadCreateInput, leadUpdateInput } from "@/features/leads/schemas";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import type { EntityCreateSession } from "@/features/permissions/entityCreate";
import { err, ok, type Result } from "@/types/result";
import { nativeError } from "./nativeErrors";
import { type NativeObjectName, nativeFieldCatalog } from "./nativeFields";
import type { NativeJson } from "./nativeFilters";
import { nativeReferenceAllowed } from "./nativePermissions";
import { lockNativeRecordForWrite, type NativeRecord, readNativeRecord } from "./nativeRecords";

export async function nativeActors(db: Db, actor: PermSetUser, signal: AbortSignal) {
  const [user] = await db
    .select({ primaryVisibilityGroupId: users.primaryVisibilityGroupId })
    .from(users)
    .where(eq(users.id, actor.id));
  signal.throwIfAborted();
  const contact: ContactActor = {
    ...actor,
    primaryVisibilityGroupId: user?.primaryVisibilityGroupId ?? null,
  };
  const session: EntityCreateSession = {
    userId: actor.id,
    isActive: actor.isActive,
    isAdmin: actor.type === "admin",
    sessionLive: true,
    primaryVisibilityGroupId: contact.primaryVisibilityGroupId,
    visibilityGroupIds: [...actor.groupIds],
    managedUserIds: [...(actor.managedUserIds ?? [])],
    flags: Object.fromEntries([...actor.flags].map((flag) => [flag, true])),
  };
  return { contact, session };
}

function previousCustomFields(current: NativeRecord | undefined): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current ?? {})) {
    if (key.startsWith("customFields.") && value !== null) fields[key.slice(13)] = value;
  }
  return fields;
}

export async function nativeWriteFields(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  raw: Record<string, NativeJson>,
  mode: "create" | "update",
  signal: AbortSignal,
  current?: NativeRecord,
): Promise<Record<string, unknown>> {
  const catalog = await nativeFieldCatalog(db, actor, objectName, signal);
  const output: Record<string, unknown> = {};
  const customFields = previousCustomFields(current);
  let hasCustom = false;
  for (const [key, value] of Object.entries(raw)) {
    const field = catalog.find((entry) => entry.key === key);
    if (field === undefined || !(mode === "create" ? field.createable : field.updateable))
      throw nativeError("workflow_native_field_not_writable");
    if (!(await nativeReferenceAllowed(db, actor, field, value, signal)))
      throw nativeError("workflow_native_reference_unavailable");
    if (key.startsWith("customFields.")) {
      customFields[key.slice(13)] = value;
      hasCustom = true;
    } else
      output[key] = key === "annualRevenue" && typeof value === "number" ? String(value) : value;
  }
  if (hasCustom) output.customFields = customFields;
  return output;
}

export function nativeFieldsSchema(
  objectName: NativeObjectName,
  mode: "create" | "update",
): z.ZodType {
  if (objectName === "deal") return mode === "create" ? dealCreateInput : dealUpdateInput;
  if (objectName === "lead") return mode === "create" ? leadCreateInput : leadUpdateInput;
  if (objectName === "person") return mode === "create" ? personCreateInput : personUpdateInput;
  if (objectName === "organization") return mode === "create" ? orgCreateInput : orgUpdateInput;
  return mode === "create" ? activityCreateInput : activityUpdateInput;
}

export async function createNativeRecord(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  raw: Record<string, NativeJson>,
  signal: AbortSignal,
): Promise<Result<{ id: string }, string>> {
  const capability =
    objectName === "person" || objectName === "organization"
      ? "contact.create"
      : objectName === "activity"
        ? "activity.create"
        : "deal.create";
  if (!can(actor, capability)) return err("E_PERM_001");
  const fields = await nativeWriteFields(db, actor, objectName, raw, "create", signal);
  const { contact, session } = await nativeActors(db, actor, signal);
  if (objectName === "deal")
    return idResult(await createDeal(db, session, dealCreateInput.parse(fields), signal));
  if (objectName === "lead")
    return idResult(await createLead(db, session, leadCreateInput.parse(fields), signal));
  if (objectName === "person")
    return idResult(await createPerson(db, contact, personCreateInput.parse(fields), signal));
  if (objectName === "organization")
    return idResult(await createOrg(db, contact, orgCreateInput.parse(fields), signal));
  return idResult(
    await createActivity(db, actor, activityCreateInput.parse(fields), signal, {
      scheduleReminder: false,
    }),
  );
}

export async function updateNativeRecord(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  id: string,
  raw: Record<string, NativeJson>,
  signal: AbortSignal,
): Promise<Result<{ id: string }, string>> {
  z.uuid().parse(id);
  const current = await lockNativeRecordForWrite(db, actor, objectName, id, signal);
  if (current === null) return err("workflow_native_record_unavailable");
  const fields = await nativeWriteFields(db, actor, objectName, raw, "update", signal, current);
  if (Object.keys(fields).length === 0) return err("workflow_native_fields_required");
  const { contact, session } = await nativeActors(db, actor, signal);
  if (objectName === "deal")
    return idResult(
      await updateDeal(
        db,
        actor,
        dealUpdateInput.parse({ ...fields, dealId: id, expectedUpdatedAt: current.updatedAt }),
        signal,
      ),
    );
  if (objectName === "lead")
    return idResult(
      await updateLead(
        db,
        session,
        leadUpdateInput.parse({ ...fields, leadId: id, expectedUpdatedAt: current.updatedAt }),
        signal,
      ),
    );
  if (objectName === "person")
    return idResult(
      await updatePerson(db, contact, personUpdateInput.parse({ ...fields, id }), signal),
    );
  if (objectName === "organization")
    return idResult(await updateOrg(db, contact, orgUpdateInput.parse({ ...fields, id }), signal));
  return idResult(
    await updateActivity(db, actor, activityUpdateInput.parse({ ...fields, id }), signal),
  );
}

export async function deleteNativeRecord(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  id: string,
  signal: AbortSignal,
): Promise<Result<{ id: string }, string>> {
  z.uuid().parse(id);
  if ((await readNativeRecord(db, actor, objectName, id, signal)) === null)
    return err("workflow_native_record_unavailable");
  const { contact, session } = await nativeActors(db, actor, signal);
  if (objectName === "deal") return idResult(await deleteDeal(db, actor, id, signal));
  if (objectName === "person") return idResult(await deletePerson(db, contact, id, signal));
  if (objectName === "organization") return idResult(await deleteOrg(db, contact, id, signal));
  if (objectName === "activity") return idResult(await deleteActivity(db, actor, id, signal));
  const deleted = await bulkUpdateLeads(
    db,
    session,
    { ids: [id], change: { deleted: true } },
    signal,
  );
  return deleted.ok
    ? deleted.value.updated === 1
      ? ok({ id })
      : err("workflow_native_record_unavailable")
    : err(deleted.error.id);
}

function idResult(result: Result<{ id: string }, { id: string }>): Result<{ id: string }, string> {
  return result.ok ? ok({ id: result.value.id }) : err(result.error.id);
}
