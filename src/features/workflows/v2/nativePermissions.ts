import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activities, activityTypes } from "@/db/schema";
import { resolveActivityVisibility } from "@/features/activities/visibility";
import { toRefActor } from "@/features/contacts/actorAdapters";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import type { VisibleRecord } from "@/features/permissions/types";
import type { NativeFieldMetadata, NativeObjectName } from "./nativeFields";
import { nativeFrom, nativeVisibility } from "./nativeRecords";

function nativePermissionPrefix(objectName: NativeObjectName): "contact" | "activity" | "deal" {
  if (objectName === "person" || objectName === "organization") return "contact";
  return objectName === "activity" ? "activity" : "deal";
}

export function nativeMutationCapability(
  actor: PermSetUser,
  objectName: NativeObjectName,
  mode: "create" | "update" | "delete",
): boolean {
  if (!actor.isActive) return false;
  if (mode === "create")
    return can(
      actor,
      objectName === "person" || objectName === "organization"
        ? "contact.create"
        : objectName === "activity"
          ? "activity.create"
          : "deal.create",
    );
  if (actor.type === "admin") return true;
  if (objectName === "lead" && mode === "delete" && !actor.flags.has("bulk.edit")) return false;
  if (objectName === "activity" && mode === "update") return true; // Assignee authority is checked against the actual row.
  const prefix = nativePermissionPrefix(objectName);
  const action = `${prefix}.${mode === "update" ? "edit" : "delete"}`;
  return [...actor.flags].some(
    (flag) => flag === `${action}_own` || flag === `${action}_any` || flag === `${action}_team`,
  );
}

export async function nativeRecordMutationAllowed(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  id: string,
  mode: "update" | "delete",
  signal: AbortSignal,
): Promise<boolean> {
  if (!nativeMutationCapability(actor, objectName, mode)) return false;
  if (objectName === "activity") return activityMutationAllowed(db, actor, id, mode, signal);
  const result = await db.execute<{
    owner_id: string;
    visibility_level: "owner" | "group" | "all";
    visibility_group_id: string | null;
    visible_to_user_ids: string[];
    pipeline_group: string | null;
  }>(sql`
    SELECT r.owner_id,r.visibility_level,r.visibility_group_id,r.visible_to_user_ids,
      ${objectName === "deal" ? sql`p.visibility_group_id` : sql`NULL::uuid`} AS pipeline_group
    FROM ${nativeFrom(objectName)} WHERE r.id=${id}::uuid AND r.deleted_at IS NULL AND ${nativeVisibility(actor, objectName)}
  `);
  signal.throwIfAborted();
  const row = result.rows[0];
  if (row === undefined) return false;
  const kind = objectName === "lead" ? "deal" : objectName;
  const base = {
    ownerId: row.owner_id,
    visibilityLevel: row.visibility_level,
    visibilityGroupId: row.visibility_group_id,
    visibleToUserIds: row.visible_to_user_ids,
  };
  const record: VisibleRecord =
    kind === "deal"
      ? { ...base, kind: "deal", pipelineVisibilityGroupId: row.pipeline_group }
      : { ...base, kind };
  const action =
    kind === "deal"
      ? mode === "update"
        ? "deal.edit"
        : "deal.delete"
      : mode === "update"
        ? "contact.edit"
        : "contact.delete";
  // Existing deal deletion layers delete authority over the editable-deal gate.
  return (
    can(actor, action, record) &&
    (kind !== "deal" || mode !== "delete" || can(actor, "deal.edit", record))
  );
}

export async function nativeReferenceAllowed(
  db: Db,
  actor: PermSetUser,
  field: NativeFieldMetadata,
  value: unknown,
  signal: AbortSignal,
): Promise<boolean> {
  if (value === null || value === undefined || field.referenceObject === undefined) return true;
  if (typeof value !== "string") return false;
  const kind = field.referenceObject;
  if (kind === "activityType") {
    const [type] = await db
      .select({ id: activityTypes.id })
      .from(activityTypes)
      .where(and(eq(activityTypes.id, value), isNull(activityTypes.archivedAt)));
    return type !== undefined;
  }
  if (kind === "pipeline" || kind === "stage") return true; // The create-deal service admits and locks the actual pipeline/stage pair.
  if (kind === "activity") return false;
  return (await assertReferenceVisible(db, toRefActor(actor), { kind, id: value }, signal)).ok;
}

async function activityMutationAllowed(
  db: Db,
  actor: PermSetUser,
  id: string,
  mode: "update" | "delete",
  signal: AbortSignal,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, id), isNull(activities.deletedAt)));
  if (row === undefined) return false;
  const visible = await resolveActivityVisibility(db, row, signal);
  return (
    visible !== null && can(actor, mode === "update" ? "activity.edit" : "activity.delete", visible)
  );
}
