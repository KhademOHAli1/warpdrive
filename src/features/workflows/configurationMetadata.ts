import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { CustomFieldType } from "@/constants/customFieldTypes";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activityTypes, workflows } from "@/db/schema";
import {
  type PreparedCustomFieldValidation,
  prepareCurrentCustomFieldValidation,
} from "@/features/custom-fields/currentValidation";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import type { CustomFieldDef } from "@/types/customFields";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import { findPaletteEntry, type PaletteExecutionReason } from "./paletteCatalog";
import { nodeTypes, type WorkflowNode } from "./schemas";

export const configurationProfileSchema = z.strictObject({
  workflowId: z.string().uuid(),
  type: z.enum(nodeTypes),
  version: z.literal(1),
});
export const configurationFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const configurationCursorInputSchema = z
  .string()
  .max(4096)
  .transform((value) => (value === "" ? undefined : value))
  .optional();
export const configurationReadInputSchema = configurationProfileSchema.extend({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: configurationCursorInputSchema,
  fingerprint: configurationFingerprintSchema.optional(),
});
export type ConfigurationReadInput = z.input<typeof configurationReadInputSchema>;
type Profile = z.infer<typeof configurationProfileSchema>;
export interface ConfigurationField {
  id: string;
  key: string;
  type: CustomFieldType;
  name: string;
  isRequired: boolean;
  isImportant: boolean;
  order: number;
  optionCount: number;
}
export interface ConfigurationStale {
  state: "stale";
  fingerprint: string;
  restart: true;
}
export type ConfigurationPage =
  | ConfigurationStale
  | {
      state: "page";
      workflowId: string;
      type: WorkflowNode["type"];
      version: 1;
      fingerprint: string;
      items: ConfigurationField[];
      nextCursor: string | null;
      totalFields: number;
      capabilities: { edit: boolean };
      executionReasons: PaletteExecutionReason[];
    };

export interface ConfigurationSnapshot {
  actor: PermSetUser;
  workflow: { id: string; ownerId: string; archivedAt: Date | null };
  prepared: PreparedCustomFieldValidation;
  defs: CustomFieldDef[];
  fingerprint: string;
}
const keySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fields"), order: z.number().int(), id: z.string().uuid() }),
  z.strictObject({ kind: z.literal("options"), ordinal: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("references"), id: z.string().uuid() }),
]);
const cursorSchema = z.strictObject({
  v: z.literal(1),
  scope: configurationFingerprintSchema,
  snapshot: configurationFingerprintSchema,
  key: keySchema,
});
export type ConfigurationCursor = z.infer<typeof cursorSchema>;

export function configurationInvalid() {
  return new AppError(ERROR_IDS.WORKFLOW_INVALID, "Invalid workflow configuration request");
}
export function configurationDenied() {
  return new AppError(ERROR_IDS.WORKFLOW_DENIED, "Workflow configuration unavailable");
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function configurationScope(
  snapshot: ConfigurationSnapshot,
  profile: Profile,
  selector: unknown,
): string {
  return hash({
    v: 1,
    workflowId: profile.workflowId,
    type: profile.type,
    version: profile.version,
    actorId: snapshot.actor.id,
    role: snapshot.actor.type,
    groups: [...snapshot.actor.groupIds].sort(),
    managed: [...(snapshot.actor.managedUserIds ?? [])].sort(),
    flags: [...snapshot.actor.flags].sort(),
    selector,
  });
}

export function readConfigurationCursor(
  raw: string | undefined,
  scope: string,
  kind: ConfigurationCursor["key"]["kind"],
): Result<ConfigurationCursor | undefined, AppError> {
  if (raw === undefined) return ok(undefined);
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) return err(configurationInvalid());
    const parsed = cursorSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    return parsed.success && parsed.data.scope === scope && parsed.data.key.kind === kind
      ? ok(parsed.data)
      : err(configurationInvalid());
  } catch {
    return err(configurationInvalid());
  }
}
export function writeConfigurationCursor(
  scope: string,
  snapshot: string,
  key: ConfigurationCursor["key"],
) {
  return Buffer.from(JSON.stringify({ v: 1, scope, snapshot, key })).toString("base64url");
}
export function configurationStale(
  snapshot: ConfigurationSnapshot,
  expected?: string,
  cursor?: ConfigurationCursor,
): ConfigurationStale | null {
  if (
    (expected !== undefined && expected !== snapshot.fingerprint) ||
    (cursor !== undefined && cursor.snapshot !== snapshot.fingerprint)
  )
    return { state: "stale", fingerprint: snapshot.fingerprint, restart: true };
  return null;
}

async function snapshot(
  db: Db,
  actor: PermSetUser,
  profile: Profile,
  signal: AbortSignal,
): Promise<Result<ConfigurationSnapshot, AppError>> {
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null || !canWorkflow(current, "view")) return err(configurationDenied());
  const [workflow] = await db
    .select({ id: workflows.id, ownerId: workflows.ownerId, archivedAt: workflows.archivedAt })
    .from(workflows)
    .where(eq(workflows.id, profile.workflowId))
    .limit(1);
  signal.throwIfAborted();
  if (workflow === undefined || !canWorkflow(current, "view", workflow.ownerId))
    return err(configurationDenied());
  if (findPaletteEntry(profile.type, profile.version) === undefined)
    return err(configurationInvalid());
  const prepared = await prepareCurrentCustomFieldValidation(db, "activity", signal);
  const defs = prepared.defs;
  return ok({ actor: current, workflow, prepared, defs, fingerprint: hash({ v: 1, defs }) });
}

export async function withConfigurationSnapshot<T>(
  db: Db,
  actor: PermSetUser,
  profile: Profile,
  signal: AbortSignal,
  read: (tx: Db, snapshot: ConfigurationSnapshot) => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> {
  signal.throwIfAborted();
  try {
    return await db.transaction(
      async (tx) => {
        const current = await snapshot(tx, actor, profile, signal);
        if (!current.ok) return current;
        const result = await read(tx, current.value);
        signal.throwIfAborted();
        return result;
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err(new AppError(ERROR_IDS.DB_READ_FAILED, "Workflow configuration read failed"));
  }
}

async function executionReasons(
  db: Db,
  actor: PermSetUser,
  profile: Profile,
  signal: AbortSignal,
): Promise<PaletteExecutionReason[]> {
  if (profile.type !== "activity.create") return [];
  const reasons: PaletteExecutionReason[] = [];
  if (!can(actor, "activity.create")) reasons.push("activity-create-required");
  const [task] = await db
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(and(eq(activityTypes.key, "task"), isNull(activityTypes.archivedAt)))
    .limit(1);
  signal.throwIfAborted();
  if (task === undefined) reasons.push("task-type-unavailable");
  return reasons;
}

function fieldDescriptor(def: CustomFieldDef): ConfigurationField {
  return {
    id: def.id,
    key: def.key,
    type: def.type,
    name: def.name,
    order: def.order,
    isRequired: def.isRequired,
    isImportant: def.isImportant,
    optionCount: ["single_option", "multi_option", "autocomplete"].includes(def.type)
      ? def.options.filter((option) => option.archived !== true).length
      : 0,
  };
}

export async function readWorkflowConfiguration(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
  raw: unknown,
): Promise<Result<ConfigurationPage, AppError>> {
  signal.throwIfAborted();
  const parsed = configurationReadInputSchema.safeParse(raw);
  if (!parsed.success) return err(configurationInvalid());
  const input = parsed.data;
  return withConfigurationSnapshot<ConfigurationPage>(
    db,
    actor,
    input,
    signal,
    async (tx, current) => {
      const scope = configurationScope(current, input, { kind: "fields", limit: input.limit });
      const cursor = readConfigurationCursor(input.cursor, scope, "fields");
      if (!cursor.ok) return cursor;
      const stale = configurationStale(current, input.fingerprint, cursor.value);
      if (stale !== null) return ok(stale);
      const defs = input.type === "activity.create" ? current.defs : [];
      const key = cursor.value?.key;
      const remaining =
        key?.kind === "fields"
          ? defs.filter(
              (def) => def.order > key.order || (def.order === key.order && def.id > key.id),
            )
          : defs;
      const shown = remaining.slice(0, input.limit);
      const last = shown.at(-1);
      return ok({
        state: "page",
        workflowId: input.workflowId,
        type: input.type,
        version: input.version,
        fingerprint: current.fingerprint,
        items: shown.map(fieldDescriptor),
        nextCursor:
          remaining.length > input.limit && last !== undefined
            ? writeConfigurationCursor(scope, current.fingerprint, {
                kind: "fields",
                order: last.order,
                id: last.id,
              })
            : null,
        totalFields: defs.length,
        capabilities: {
          edit:
            current.workflow.archivedAt === null &&
            canWorkflow(current.actor, "edit", current.workflow.ownerId),
        },
        executionReasons: await executionReasons(tx, current.actor, input, signal),
      });
    },
  );
}
