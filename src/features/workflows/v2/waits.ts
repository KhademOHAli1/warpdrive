import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  workflowsV2,
  workflowV2Executions,
  workflowV2Runs,
  workflowV2Versions,
  workflowV2Waits,
} from "@/db/schema/workflowV2";
import { resolveBlockConfig } from "@/features/blocks/bindings";
import type { BlockJson, BlockOutput, WorkflowV2Adapters } from "@/features/blocks/contracts";
import { blockOutputSchema } from "@/features/blocks/schemas";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "../access";
import { type AdvanceResult, completeV2Step } from "./runner";
import { V2_ERROR } from "./shared";

type Wait = typeof workflowV2Waits.$inferSelect;
function object(value: unknown): value is BlockOutput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function formValueMatches(field: BlockOutput, value: BlockJson | undefined): boolean {
  if (value === undefined || value === null || value === "") return field.required !== true;
  const type = field.type;
  if (typeof type !== "string") return false;
  switch (type) {
    case "TEXT":
      return typeof value === "string" && value.length <= 10_000;
    case "NUMBER":
      return typeof value === "number" && Number.isFinite(value);
    case "DATE":
      return typeof value === "string" && z.iso.date().safeParse(value).success;
    case "RECORD":
      return typeof field.objectName === "string" && z.uuid().safeParse(value).success;
    case "SELECT":
      return Array.isArray(field.options) && field.options.includes(value);
    case "MULTI_SELECT": {
      const options = field.options;
      return (
        Array.isArray(value) &&
        Array.isArray(options) &&
        (field.required !== true || value.length > 0) &&
        value.every((item) => typeof item === "string" && options.includes(item))
      );
    }
    default:
      return false;
  }
}
export function validateFormResponse(config: BlockOutput, response: BlockOutput): boolean {
  if (!Array.isArray(config.fields) || JSON.stringify(response).length > 100_000) return false;
  const names = new Set<string>();
  for (const field of config.fields) {
    if (
      !object(field) ||
      typeof field.name !== "string" ||
      names.has(field.name) ||
      !formValueMatches(field, response[field.name])
    )
      return false;
    names.add(field.name);
  }
  return Object.keys(response).every((name) => names.has(name));
}
async function authorizedResume(
  db: Db,
  wait: Wait,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  const [run] = await db
    .select()
    .from(workflowV2Runs)
    .where(eq(workflowV2Runs.id, wait.runId))
    .for("update");
  if (run === undefined || run.status !== "waiting") return err(V2_ERROR.inactive);
  const actor = await hydrateActor(db, run.actorId, signal);
  const [workflow] = await db.select().from(workflowsV2).where(eq(workflowsV2.id, run.workflowId));
  if (
    actor === null ||
    workflow === undefined ||
    !workflow.active ||
    workflow.archivedAt !== null ||
    !canWorkflow(actor, "run", workflow.ownerId)
  )
    return err(V2_ERROR.denied);
  const [version] = await db
    .select()
    .from(workflowV2Versions)
    .where(eq(workflowV2Versions.id, run.versionId));
  const [execution] = await db
    .select()
    .from(workflowV2Executions)
    .where(eq(workflowV2Executions.id, wait.executionId));
  const node = version?.definition.nodes.find((row) => row.id === execution?.nodeId);
  if (version === undefined || execution === undefined || node === undefined)
    return err(V2_ERROR.invalid);
  const resolved = resolveBlockConfig(
    node.config,
    run.state.outputs,
    execution.framePath,
    run.trigger,
  );
  if (!resolved.ok) return resolved;
  const effectNode = { ...node, config: resolved.value };
  if (
    wait.kind === "chat" &&
    (await adapters.readiness(db, actor, effectNode, signal)).state !== "ready"
  )
    return err(V2_ERROR.notReady);
  return ok({ run, actor, version, execution, node });
}
async function applyWait(
  db: Db,
  wait: Wait,
  output: BlockOutput,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
  receiptKey: string,
  expired = false,
) {
  const current = await authorizedResume(db, wait, adapters, signal);
  if (!current.ok) return current;
  const result = await completeV2Step(
    db,
    current.value.run,
    current.value.execution,
    current.value.version.definition,
    current.value.node,
    { output, ...(wait.kind === "chat" && output.approved === false ? { stop: true } : {}) },
  );
  await db
    .update(workflowV2Waits)
    .set({ status: expired ? "expired" : "resumed", output, receiptKey, resumedAt: new Date() })
    .where(eq(workflowV2Waits.id, wait.id));
  return ok(result);
}
type ResponseKind = "form" | "chat";
function responseKind(kind: Wait["kind"]): kind is ResponseKind {
  return kind === "form" || kind === "chat";
}
async function pendingWaitRows(db: Db, responderId: string, id?: string) {
  return db
    .select({
      wait: workflowV2Waits,
      actorId: workflowV2Runs.actorId,
      ownerId: workflowsV2.ownerId,
    })
    .from(workflowV2Waits)
    .innerJoin(workflowV2Runs, eq(workflowV2Runs.id, workflowV2Waits.runId))
    .innerJoin(workflowsV2, eq(workflowsV2.id, workflowV2Runs.workflowId))
    .where(
      and(
        eq(workflowV2Waits.responderId, responderId),
        eq(workflowV2Waits.status, "open"),
        or(eq(workflowV2Waits.kind, "form"), eq(workflowV2Waits.kind, "chat")),
        eq(workflowV2Runs.status, "waiting"),
        eq(workflowsV2.active, true),
        isNull(workflowsV2.archivedAt),
        id === undefined ? undefined : eq(workflowV2Waits.id, id),
      ),
    )
    .orderBy(desc(workflowV2Waits.createdAt))
    .limit(id === undefined ? 100 : 1);
}
export async function readWorkflowV2Form(
  db: Db,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
) {
  if (!z.uuid().safeParse(id).success) return err(V2_ERROR.invalid);
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null) return err(V2_ERROR.denied);
  const [row] = await pendingWaitRows(db, current.id, id);
  if (row === undefined || !responseKind(row.wait.kind)) return err(V2_ERROR.denied);
  const owner = await hydrateActor(db, row.actorId, signal);
  if (owner === null || !canWorkflow(owner, "run", row.ownerId)) return err(V2_ERROR.denied);
  const { wait } = row;
  const config: BlockOutput =
    wait.kind === "form"
      ? { fields: wait.config.fields ?? [], instructions: wait.config.instructions ?? "" }
      : { title: wait.config.title ?? "", message: wait.config.message ?? "" };
  return ok({ id: wait.id, kind: row.wait.kind, config });
}
export async function listPendingWorkflowV2Inputs(db: Db, actor: PermSetUser, signal: AbortSignal) {
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null) return err(V2_ERROR.denied);
  const rows = await pendingWaitRows(db, current.id);
  const actors = new Map<string, PermSetUser | null>();
  const values: { id: string; kind: ResponseKind; title: string | null; createdAt: string }[] = [];
  for (const { wait, actorId, ownerId } of rows) {
    if (!responseKind(wait.kind)) continue;
    if (!actors.has(actorId)) actors.set(actorId, await hydrateActor(db, actorId, signal));
    const owner = actors.get(actorId);
    if (owner === undefined || owner === null || !canWorkflow(owner, "run", ownerId)) continue;
    values.push({
      id: wait.id,
      kind: wait.kind,
      title: typeof wait.config.title === "string" ? wait.config.title : null,
      createdAt: wait.createdAt.toISOString(),
    });
  }
  return ok(values);
}
async function lockWait(db: Db, id: string): Promise<Wait | null> {
  const [lookup] = await db
    .select({ runId: workflowV2Waits.runId })
    .from(workflowV2Waits)
    .where(eq(workflowV2Waits.id, id));
  if (lookup === undefined) return null;
  await db
    .select({ id: workflowV2Runs.id })
    .from(workflowV2Runs)
    .where(eq(workflowV2Runs.id, lookup.runId))
    .for("update");
  const [wait] = await db
    .select()
    .from(workflowV2Waits)
    .where(eq(workflowV2Waits.id, id))
    .for("update");
  return wait ?? null;
}
async function responseRecordsVisible(
  db: Db,
  actor: PermSetUser,
  wait: Wait,
  response: BlockOutput,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  if (wait.kind !== "form" || !Array.isArray(wait.config.fields)) return true;
  for (const field of wait.config.fields) {
    if (
      !object(field) ||
      field.type !== "RECORD" ||
      typeof field.name !== "string" ||
      typeof field.objectName !== "string"
    )
      continue;
    const value = response[field.name];
    if (typeof value !== "string") continue;
    const config = {
      objectName: field.objectName,
      filters: [{ field: "id", operator: "eq", value }],
      limit: 1,
    };
    const check = await adapters.native(db, {
      actor,
      node: {
        id: "form_record_check",
        type: "FIND_RECORDS",
        version: 1,
        name: "Response record",
        config,
      },
      resolvedConfig: config,
      effectKey: wait.id,
      signal,
      nextPickIndex: () => Promise.resolve(0),
    });
    if (!check.ok || !Array.isArray(check.value.records) || check.value.records.length !== 1)
      return false;
  }
  return true;
}
export async function resumeWorkflowV2Form(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
): Promise<Result<AdvanceResult, string>> {
  const input = z
    .strictObject({
      waitId: z.uuid(),
      response: blockOutputSchema,
      requestKey: z.uuid().optional(),
    })
    .safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  return db.transaction(async (tx) => {
    // Every resume path locks run before wait, matching worker execution lock order.
    const wait = await lockWait(tx, input.data.waitId);
    const responder = await hydrateActor(tx, actor.id, signal);
    if (
      wait === null ||
      responder === null ||
      wait.responderId !== responder.id ||
      !responseKind(wait.kind)
    )
      return err(V2_ERROR.denied);
    if (wait.status !== "open")
      return input.data.requestKey !== undefined && wait.receiptKey === input.data.requestKey
        ? ok({ runId: wait.runId, status: "running" as const })
        : err(V2_ERROR.conflict);
    const response = input.data.response;
    if (wait.kind === "form" && !validateFormResponse(wait.config, response))
      return err(V2_ERROR.invalid);
    if (wait.kind === "chat" && typeof response.approved !== "boolean")
      return err(V2_ERROR.invalid);
    if (!(await responseRecordsVisible(tx, responder, wait, response, adapters, signal)))
      return err(V2_ERROR.denied);
    const output: BlockOutput =
      wait.kind === "chat" ? { approved: response.approved ?? false } : { response };
    return applyWait(
      tx,
      wait,
      output,
      adapters,
      signal,
      input.data.requestKey ?? crypto.randomUUID(),
    );
  });
}
export async function resumeDueWorkflowV2Waits(
  db: Db,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
  now = new Date(),
) {
  const due = await db
    .select({ id: workflowV2Waits.id, runId: workflowV2Waits.runId })
    .from(workflowV2Waits)
    .where(
      and(
        eq(workflowV2Waits.status, "open"),
        or(lte(workflowV2Waits.wakeAt, now), lte(workflowV2Waits.expiresAt, now)),
      ),
    )
    .limit(100);
  const runs: string[] = [];
  for (const row of due) {
    signal.throwIfAborted();
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: workflowV2Runs.id })
        .from(workflowV2Runs)
        .where(eq(workflowV2Runs.id, row.runId))
        .for("update");
      const [wait] = await tx
        .select()
        .from(workflowV2Waits)
        .where(eq(workflowV2Waits.id, row.id))
        .for("update");
      if (wait === undefined || wait.status !== "open") return null;
      const expired = wait.kind === "event" && wait.expiresAt !== null && wait.expiresAt <= now;
      if (wait.kind !== "delay" && !expired) return null;
      return applyWait(
        tx,
        wait,
        expired ? { hasTimedOut: true } : { resumedAt: now.toISOString() },
        adapters,
        signal,
        `due:${wait.id}`,
        expired,
      );
    });
    if (result?.ok === true) runs.push(row.runId);
  }
  return runs;
}
export async function resumeV2EventWait(
  db: Db,
  waitId: string,
  output: BlockOutput,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
  eventKey: string,
) {
  return db.transaction(async (tx) => {
    const [lookup] = await tx.select().from(workflowV2Waits).where(eq(workflowV2Waits.id, waitId));
    if (lookup === undefined) return err(V2_ERROR.missing);
    await tx
      .select({ id: workflowV2Runs.id })
      .from(workflowV2Runs)
      .where(eq(workflowV2Runs.id, lookup.runId))
      .for("update");
    const [wait] = await tx
      .select()
      .from(workflowV2Waits)
      .where(eq(workflowV2Waits.id, waitId))
      .for("update");
    if (wait === undefined || wait.status !== "open" || wait.kind !== "event")
      return err(V2_ERROR.conflict);
    return applyWait(tx, wait, { ...output, hasTimedOut: false }, adapters, signal, eventKey);
  });
}
