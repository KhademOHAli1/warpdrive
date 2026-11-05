import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import {
  ACTION_BLOCK_KINDS,
  type BlockFieldDescriptor,
  type WorkflowV2Adapters,
  type WorkflowV2Studio,
} from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "../access";
import { readExternalStudioMetadata } from "./externalMetadata";
import { NATIVE_OBJECT_NAMES, type NativeFieldMetadata, nativeFieldCatalog } from "./nativeFields";
import { findNativeRecords } from "./nativeRecords";
import { V2_ERROR } from "./shared";

function fieldDto(field: NativeFieldMetadata): BlockFieldDescriptor {
  return {
    key: field.key,
    label: field.label,
    type: field.valueType,
    required: field.required,
    readable: field.readable,
    createable: field.createable,
    updateable: field.updateable,
    filterOperators: field.filterOperators,
    format: field.format,
    referenceObject: field.referenceObject,
    upsertIdentity: field.upsertIdentity,
    ...(field.options !== undefined
      ? { choices: field.options.map((option) => ({ value: option.id, label: option.label })) }
      : {}),
  };
}
export async function readWorkflowV2Studio(
  db: Db,
  actor: PermSetUser,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null || !canWorkflow(current, "view")) return err(V2_ERROR.denied);
  const objects: WorkflowV2Studio["objects"] = [];
  for (const name of NATIVE_OBJECT_NAMES)
    objects.push({
      name,
      label: name,
      fields: (await nativeFieldCatalog(db, current, name, signal, { includeChoices: true })).map(
        fieldDto,
      ),
    });
  const members = await db
    .select({ id: users.id, label: users.name })
    .from(users)
    .where(eq(users.isActive, true))
    .limit(500);
  const external = await readExternalStudioMetadata(db, current, signal);
  const readiness: WorkflowV2Studio["readiness"] = {};
  for (const type of ACTION_BLOCK_KINDS)
    readiness[type] = ["FILTER", "IF_ELSE", "ITERATOR", "DELAY", "FORM", "WAIT_FOR_EVENT"].includes(
      type,
    )
      ? { state: "needs_configuration", reason: "configure_block" }
      : await adapters.readiness(
          db,
          current,
          { id: "palette", type, version: 1, name: type, config: {} },
          signal,
        );
  return ok({ objects, members, ...external, readiness } satisfies WorkflowV2Studio);
}
export async function lookupWorkflowV2Records(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = z
    .strictObject({
      objectName: z.enum(NATIVE_OBJECT_NAMES),
      search: z.string().trim().max(200).default(""),
    })
    .safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null || !canWorkflow(current, "view")) return err(V2_ERROR.denied);
  const key =
    input.data.objectName === "person"
      ? "firstName"
      : input.data.objectName === "organization"
        ? "name"
        : input.data.objectName === "activity"
          ? "subject"
          : "title";
  try {
    const records = await findNativeRecords(
      db,
      current,
      {
        objectName: input.data.objectName,
        filters:
          input.data.search.length > 0
            ? [{ field: key, operator: "contains", value: input.data.search }]
            : [],
        sort: { field: key, direction: "asc" },
        limit: 30,
      },
      signal,
    );
    return ok(
      records.map((record) => ({
        id: record.id,
        label:
          typeof record[key] === "string"
            ? `${record[key]}${key === "firstName" && typeof record.lastName === "string" ? ` ${record.lastName}` : ""}`
            : record.id,
      })),
    );
  } catch {
    return err(V2_ERROR.denied);
  }
}
