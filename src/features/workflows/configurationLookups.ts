import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { buildUuidArray, dealVisibilityPredicate } from "@/features/permissions/sql";
import type { CustomFieldOption } from "@/types/customFields";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import {
  type ConfigurationSnapshot,
  type ConfigurationStale,
  configurationCursorInputSchema,
  configurationDenied,
  configurationFingerprintSchema,
  configurationInvalid,
  configurationProfileSchema,
  configurationScope,
  configurationStale,
  readConfigurationCursor,
  withConfigurationSnapshot,
  writeConfigurationCursor,
} from "./configurationMetadata";
import { librarySubstringPattern } from "./libraryInput";
import type { WorkflowNode } from "./schemas";
import { visibleWorkflowRecordSource } from "./workflowRecordQuery";
import { recordLookupEntitySchema, recordSearchPrimary } from "./workflowRecordQueryContract";

const querySchema = z.string().trim().max(200).default("");
export const configurationOptionsInputSchema = configurationProfileSchema.extend({
  fieldId: z.string().uuid(),
  fingerprint: configurationFingerprintSchema,
  query: querySchema,
  limit: z.number().int().min(1).max(100).default(50),
  cursor: configurationCursorInputSchema,
});
export type ConfigurationOptionsInput = z.input<typeof configurationOptionsInputSchema>;
export type ConfigurationOptionsPage =
  | ConfigurationStale
  | {
      state: "page";
      workflowId: string;
      type: WorkflowNode["type"];
      version: 1;
      fieldId: string;
      fingerprint: string;
      query: string;
      items: { id: string; label: string; color?: string }[];
      nextCursor: string | null;
      totalOptions: number;
    };
const selectorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("builtin"), name: z.enum(["recordId", "dealId"]) }),
  z.strictObject({ kind: z.literal("custom"), fieldId: z.string().uuid() }),
  z.strictObject({ kind: z.literal("record"), entity: recordLookupEntitySchema }),
]);
export type ConfigurationReferenceSelector = z.infer<typeof selectorSchema>;
const referenceBase = configurationProfileSchema.extend({
  field: selectorSchema,
  fingerprint: configurationFingerprintSchema.optional(),
});
export const configurationReferencesInputSchema = z
  .discriminatedUnion("mode", [
    referenceBase.extend({
      mode: z.literal("search"),
      query: querySchema,
      limit: z.number().int().min(1).max(100).default(25),
      cursor: configurationCursorInputSchema,
    }),
    referenceBase.extend({
      mode: z.literal("selected"),
      ids: z.array(z.string().uuid()).min(1).max(100),
    }),
  ])
  .superRefine((input, ctx) => {
    if (input.field.kind === "custom" && input.fingerprint === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["fingerprint"],
        message: "Current field fingerprint required",
      });
  });
export type ConfigurationReferencesInput = z.input<typeof configurationReferencesInputSchema>;
export type ConfigurationReferencesPage =
  | ConfigurationStale
  | {
      state: "page";
      workflowId: string;
      type: WorkflowNode["type"];
      version: 1;
      fingerprint: string;
      field: ConfigurationReferenceSelector;
      mode: "search" | "selected";
      query: string;
      items: { id: string; label: string }[];
      nextCursor: string | null;
    };
type ReferenceInput = z.infer<typeof configurationReferencesInputSchema>;
type ReferenceTarget = "deal" | "lead" | "person" | "organization" | "activity" | "user";

function optionPresentation(option: CustomFieldOption) {
  return option.color === undefined
    ? { id: option.id, label: option.label }
    : { id: option.id, label: option.label, color: option.color };
}

function optionsFromSnapshot(
  current: ConfigurationSnapshot,
  input: z.output<typeof configurationOptionsInputSchema>,
): Result<ConfigurationOptionsPage, AppError> {
  const scope = configurationScope(current, input, {
    kind: "options",
    fieldId: input.fieldId,
    query: input.query,
    limit: input.limit,
  });
  const cursor = readConfigurationCursor(input.cursor, scope, "options");
  if (!cursor.ok) return cursor;
  const stale = configurationStale(current, input.fingerprint, cursor.value);
  if (stale !== null) return ok(stale);
  const def = current.defs.find((item) => item.id === input.fieldId);
  if (input.type !== "activity.create" || def === undefined) return err(configurationDenied());
  if (!["single_option", "multi_option", "autocomplete"].includes(def.type))
    return err(configurationInvalid());
  const active = def.options
    .map((option, ordinal) => ({ option, ordinal }))
    .filter((row) => row.option.archived !== true);
  const after = cursor.value?.key;
  const query = input.query.toLocaleLowerCase();
  const matches = active.filter(
    (row) =>
      (after?.kind !== "options" || row.ordinal > after.ordinal) &&
      row.option.label.toLocaleLowerCase().includes(query),
  );
  const shown = matches.slice(0, input.limit);
  const last = shown.at(-1);
  return ok({
    state: "page",
    workflowId: input.workflowId,
    type: input.type,
    version: input.version,
    fieldId: input.fieldId,
    fingerprint: current.fingerprint,
    query: input.query,
    items: shown.map((row) => optionPresentation(row.option)),
    totalOptions: active.length,
    nextCursor:
      matches.length > input.limit && last !== undefined
        ? writeConfigurationCursor(scope, current.fingerprint, {
            kind: "options",
            ordinal: last.ordinal,
          })
        : null,
  });
}

export async function readWorkflowConfigurationOptions(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
  raw: unknown,
): Promise<Result<ConfigurationOptionsPage, AppError>> {
  signal.throwIfAborted();
  const parsed = configurationOptionsInputSchema.safeParse(raw);
  if (!parsed.success) return err(configurationInvalid());
  const input = parsed.data;
  return withConfigurationSnapshot<ConfigurationOptionsPage>(
    db,
    actor,
    input,
    signal,
    (_tx, current) => Promise.resolve(optionsFromSnapshot(current, input)),
  );
}

function namedRecordTarget(
  input: ReferenceInput,
  current: ConfigurationSnapshot,
  entity: Extract<ConfigurationReferenceSelector, { kind: "record" }>["entity"],
): Result<ReferenceTarget, AppError> {
  if (
    input.type !== "record.update" &&
    input.type !== "record.delete" &&
    input.type !== "record.pick" &&
    !(input.type === "record.upsert" && entity === "organization")
  )
    return err(configurationInvalid());
  if (
    input.mode === "search" &&
    (current.workflow.archivedAt !== null ||
      !canWorkflow(current.actor, "edit", current.workflow.ownerId))
  )
    return err(configurationDenied());
  return ok(entity);
}

function targetFor(
  input: ReferenceInput,
  current: ConfigurationSnapshot,
): Result<ReferenceTarget, AppError> {
  const field = input.field;
  if (field.kind === "builtin") {
    if (
      (input.type === "record.read" && field.name === "recordId") ||
      (input.type === "activity.create" && field.name === "dealId")
    )
      return ok("deal");
    return err(configurationInvalid());
  }
  if (field.kind === "record") return namedRecordTarget(input, current, field.entity);
  if (input.type !== "activity.create") return err(configurationInvalid());
  const def = current.defs.find((item) => item.id === field.fieldId);
  if (def === undefined) return err(configurationDenied());
  if (def.type === "org") return ok("organization");
  return def.type === "person" || def.type === "user" ? ok(def.type) : err(configurationInvalid());
}

function sourceFor(target: ReferenceTarget): SQL {
  if (target === "deal") return sql`deals r INNER JOIN pipelines p ON p.id = r.pipeline_id`;
  if (target === "person") return sql`persons r`;
  if (target === "organization") return sql`organizations r`;
  return sql`users r`;
}

function referenceVisibility(actor: PermSetUser, target: ReferenceTarget): SQL {
  if (target === "user") return sql`r.is_active = true`;
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
      pipelineVisibilityGroupId: target === "deal" ? sql`p.visibility_group_id` : sql`NULL::uuid`,
    },
  );
  return target === "deal"
    ? sql`r.deleted_at IS NULL AND p.is_archived = false AND (${visible})`
    : sql`r.deleted_at IS NULL AND (${visible})`;
}

async function referenceRows(
  db: Db,
  current: ConfigurationSnapshot,
  input: ReferenceInput,
  target: ReferenceTarget,
  after?: string,
) {
  const source =
    input.field.kind === "record" && target !== "user"
      ? visibleWorkflowRecordSource(target, current.actor)
      : undefined;
  const label =
    source !== undefined && target !== "user"
      ? source.field(recordSearchPrimary[target])
      : target === "deal"
        ? sql`r.title`
        : sql`r.name`;
  const id = source?.field("id") ?? sql`r.id`;
  const conditions = [source?.visible ?? referenceVisibility(current.actor, target)];
  if (input.mode === "selected") conditions.push(sql`${id} = ANY(${buildUuidArray(input.ids)})`);
  else {
    if (input.query !== "")
      conditions.push(sql`${label} ILIKE ${librarySubstringPattern(input.query)} ESCAPE E'\\\\'`);
    if (after !== undefined) conditions.push(sql`${id} > ${after}::uuid`);
  }
  const limit = input.mode === "selected" ? input.ids.length : input.limit + 1;
  const result = await db.execute<{ id: string; label: string }>(
    sql`SELECT ${id} AS id, ${label} AS label FROM ${source?.from ?? sourceFor(target)} WHERE ${sql.join(conditions, sql` AND `)} ORDER BY ${id} ASC LIMIT ${limit}`,
  );
  return result.rows;
}

export async function readWorkflowConfigurationReferences(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
  raw: unknown,
): Promise<Result<ConfigurationReferencesPage, AppError>> {
  signal.throwIfAborted();
  const parsed = configurationReferencesInputSchema.safeParse(raw);
  if (!parsed.success) return err(configurationInvalid());
  const input = parsed.data;
  return withConfigurationSnapshot<ConfigurationReferencesPage>(
    db,
    actor,
    input,
    signal,
    async (tx, current) => {
      const stale = configurationStale(current, input.fingerprint);
      if (stale !== null) return ok(stale);
      const target = targetFor(input, current);
      if (!target.ok) return target;
      const query = input.mode === "search" ? input.query : "";
      const limit = input.mode === "search" ? input.limit : input.ids.length;
      const scope = configurationScope(current, input, {
        kind: "references",
        target: target.value,
        field: input.field,
        query,
        limit,
      });
      const cursor = readConfigurationCursor(
        input.mode === "search" ? input.cursor : undefined,
        scope,
        "references",
      );
      if (!cursor.ok) return cursor;
      const changed = configurationStale(current, input.fingerprint, cursor.value);
      if (changed !== null) return ok(changed);
      const key = cursor.value?.key;
      const rows = await referenceRows(
        tx,
        current,
        input,
        target.value,
        key?.kind === "references" ? key.id : undefined,
      );
      signal.throwIfAborted();
      const items = rows.slice(0, limit).map(({ id, label }) => ({ id, label }));
      const last = items.at(-1);
      return ok({
        state: "page",
        workflowId: input.workflowId,
        type: input.type,
        version: input.version,
        field: input.field,
        fingerprint: current.fingerprint,
        mode: input.mode,
        query,
        items,
        nextCursor:
          input.mode === "search" && rows.length > limit && last !== undefined
            ? writeConfigurationCursor(scope, current.fingerprint, {
                kind: "references",
                id: last.id,
              })
            : null,
      });
    },
  );
}
