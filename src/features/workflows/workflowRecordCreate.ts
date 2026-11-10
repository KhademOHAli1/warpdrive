import { and, eq, isNull, TransactionRollbackError } from "drizzle-orm";
import { type AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activityTypes } from "@/db/schema";
import { createActivity } from "@/features/activities/repo";
import { activityCreateInput } from "@/features/activities/schemas";
import { loadContactActor, toRefActor } from "@/features/contacts/actorAdapters";
import { createOrg } from "@/features/contacts/orgsRepo";
import { createPerson } from "@/features/contacts/personsRepo";
import { orgCreateInput, personCreateInput } from "@/features/contacts/schemas";
import { createDeal } from "@/features/deals/dealActions";
import { dealCreateInput } from "@/features/deals/schemas";
import { createLead } from "@/features/leads/leadActions";
import { leadCreateInput } from "@/features/leads/schemas";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import type { EntityCreateSession } from "@/features/permissions/entityCreate";
import { err, ok, type Result } from "@/types/result";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs, StepOutput } from "./runTypes";
import { nodeSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";
import {
  type RecordCreateConfig,
  type RecordCreateEntity,
  recordCreateConfig,
  recordCreateFields,
} from "./workflowRecordCreateContract";

export type RecordCreateMode = "live" | "simulation" | "draft-simulation";
type ResolvedFields = Record<string, string | number>;
type RecordResult = Result<StepOutput, string>;

const createPermission = {
  deal: "deal.create",
  lead: "deal.create",
  person: "contact.create",
  organization: "contact.create",
  activity: "activity.create",
} as const;

function resolveFields(
  config: RecordCreateConfig,
  definition: WorkflowDefinition,
  nodeId: string,
  outputs: RunOutputs,
): Result<ResolvedFields, string> {
  const fields: ResolvedFields = {};
  for (const field of recordCreateFields[config.entity]) {
    const binding = config.fields[field.key];
    if (binding === undefined) continue;
    const resolved = resolveRunBinding(binding, outputs, {
      definition,
      nodeId,
      path: ["fields", field.key],
    });
    if (resolved.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
    if (resolved.state === "missing") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
    if (resolved.state === "null") {
      if (field.required === true) return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
      continue;
    }
    const value = field.schema.safeParse(resolved.value);
    if (!value.success) return err(ERROR_IDS.WORKFLOW_INVALID);
    fields[field.key] = value.data;
  }
  return ok(fields);
}

function projectId(result: Result<{ id: string }, AppError>): RecordResult {
  return result.ok ? ok({ id: result.value.id }) : err(result.error.id);
}

async function createSession(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
): Promise<EntityCreateSession> {
  const { primaryVisibilityGroupId } = await loadContactActor(db, actor, signal);
  return {
    ...toRefActor(actor),
    primaryVisibilityGroupId,
    flags: Object.fromEntries([...actor.flags].map((flag) => [flag, true])),
  };
}

async function createTaskRecord(
  db: Db,
  actor: PermSetUser,
  fields: ResolvedFields,
  signal: AbortSignal,
): Promise<RecordResult> {
  const [task] = await db
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(and(eq(activityTypes.key, "task"), isNull(activityTypes.archivedAt)));
  signal.throwIfAborted();
  if (task === undefined) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const input = activityCreateInput.safeParse({ ...fields, typeId: task.id });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return projectId(
    await createActivity(db, actor, input.data, signal, { scheduleReminder: false }),
  );
}

async function createContactRecord(
  db: Db,
  actor: PermSetUser,
  entity: "person" | "organization",
  fields: ResolvedFields,
  signal: AbortSignal,
): Promise<RecordResult> {
  const contactActor = {
    ...(await loadContactActor(db, actor, signal)),
    managedUserIds: actor.managedUserIds,
  };
  if (entity === "person") {
    const { email, phone, ...person } = fields;
    const input = personCreateInput.safeParse({
      ...person,
      emails: email === undefined ? [] : [{ value: email, label: "", primary: true }],
      phones: phone === undefined ? [] : [{ value: phone, label: "", primary: true }],
    });
    if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
    return projectId(await createPerson(db, contactActor, input.data, signal));
  }
  const { name, ...address } = fields;
  const input = orgCreateInput.safeParse({
    name,
    address: Object.keys(address).length === 0 ? null : address,
  });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return projectId(await createOrg(db, contactActor, input.data, signal));
}

async function writeRecord(
  db: Db,
  actor: PermSetUser,
  entity: RecordCreateEntity,
  fields: ResolvedFields,
  signal: AbortSignal,
): Promise<RecordResult> {
  switch (entity) {
    case "activity":
      return createTaskRecord(db, actor, fields, signal);
    case "person":
    case "organization":
      return createContactRecord(db, actor, entity, fields, signal);
    case "deal": {
      const input = dealCreateInput.safeParse(fields);
      if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
      const session = await createSession(db, actor, signal);
      return projectId(await createDeal(db, session, input.data, signal));
    }
    case "lead": {
      const input = leadCreateInput.safeParse({ ...fields, sourceOrigin: "workflow" });
      if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
      const session = await createSession(db, actor, signal);
      return projectId(await createLead(db, session, input.data, signal));
    }
  }
}

export async function withRecordWriteTransaction(
  db: Db,
  mode: RecordCreateMode,
  signal: AbortSignal,
  write: (tx: Db) => Promise<RecordResult>,
): Promise<RecordResult> {
  if (mode === "draft-simulation" && !("rollback" in db))
    return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);

  const rollback: { result?: RecordResult } = {};
  try {
    return await db.transaction(async (tx) => {
      const result = await write(tx);
      signal.throwIfAborted();
      // Failed writes and published previews must leave no CRM effects. Draft
      // tests can read test records before their enclosing transaction rolls back.
      if (!result.ok || mode === "simulation") {
        rollback.result = result;
        tx.rollback();
      }
      return result;
    });
  } catch (error) {
    signal.throwIfAborted();
    if (rollback.result !== undefined && error instanceof TransactionRollbackError)
      return rollback.result;
    throw error;
  }
}

export async function createWorkflowRecord(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  mode: RecordCreateMode,
  signal: AbortSignal,
): Promise<RecordResult> {
  signal.throwIfAborted();
  if (node.type !== "record.create" || !nodeSchema.shape.version.safeParse(node.version).success)
    return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const parsed = recordCreateConfig.safeParse(node.config);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const { entity } = parsed.data;
  if (!can(actor, createPermission[entity])) return err(ERROR_IDS.PERM_DENIED);
  const fields = resolveFields(parsed.data, definition, node.id, outputs);
  if (!fields.ok) return fields;

  return withRecordWriteTransaction(db, mode, signal, (tx) =>
    writeRecord(tx, actor, entity, fields.value, signal),
  );
}
