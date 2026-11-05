"use server";

import { requireFreshIdentityAction } from "@/features/identity/actions/fresh";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { Result } from "@/types/result";
import { createWorkflowV2Adapters } from "./adapters";
import { startWorkflowV2 } from "./admission";
import { listWorkflowAllEngines } from "./library";
import {
  changeWorkflowV2State,
  createWorkflowV2,
  duplicateWorkflowV2,
  listWorkflowV2,
  publishWorkflowV2,
  readWorkflowV2,
  saveWorkflowV2,
} from "./persistence";
import { cancelWorkflowV2Run, listWorkflowV2Runs, readWorkflowV2Run } from "./queries";
import { V2_ERROR } from "./shared";
import { testWorkflowV2Draft } from "./simulation";
import { lookupWorkflowV2Records, readWorkflowV2Studio } from "./studio";
import { listPendingWorkflowV2Inputs, readWorkflowV2Form, resumeWorkflowV2Form } from "./waits";
import { rotateWorkflowV2Webhook } from "./webhook";
import { nudgeWorkflowV2Run } from "./worker";

async function context(token?: string | null) {
  if (token !== undefined && !(await guardCsrf(token)).ok) return null;
  const ctx = await createContext();
  return ctx.actor === null ? null : { db: ctx.db, actor: ctx.actor };
}
function result<T>(value: Result<T, string>) {
  return value.ok ? value : { ok: false as const, error: { id: value.error } };
}
const denied = () => ({ ok: false as const, error: { id: V2_ERROR.denied } });
export async function createWorkflowV2Action(input: unknown, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(await createWorkflowV2(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000)));
}
export async function saveWorkflowV2Action(input: unknown, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(await saveWorkflowV2(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000)));
}
export async function readWorkflowV2Action(id: string) {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(await readWorkflowV2(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000)));
}
export async function listWorkflowV2Action() {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(await listWorkflowV2(ctx.db, ctx.actor, AbortSignal.timeout(10_000)));
}
export async function listWorkflowAllEnginesAction(input?: unknown) {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(await listWorkflowAllEngines(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000)));
}
export async function publishWorkflowV2Action(input: unknown, token: string | null) {
  const ctx = await context(token);
  if (ctx === null) return denied();
  if (!(await requireFreshIdentityAction()).ok) return denied();
  return result(
    await publishWorkflowV2(
      ctx.db,
      ctx.actor,
      input,
      createWorkflowV2Adapters(),
      AbortSignal.timeout(15_000),
    ),
  );
}
export async function pauseWorkflowV2Action(input: unknown, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(
        await changeWorkflowV2State(ctx.db, ctx.actor, input, "pause", AbortSignal.timeout(10_000)),
      );
}
export async function archiveWorkflowV2Action(input: unknown, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(
        await changeWorkflowV2State(
          ctx.db,
          ctx.actor,
          input,
          "archive",
          AbortSignal.timeout(10_000),
        ),
      );
}
export async function unarchiveWorkflowV2Action(input: unknown, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(
        await changeWorkflowV2State(
          ctx.db,
          ctx.actor,
          input,
          "unarchive",
          AbortSignal.timeout(10_000),
        ),
      );
}
export async function duplicateWorkflowV2Action(input: unknown, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(await duplicateWorkflowV2(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000)));
}
export async function startWorkflowV2Action(input: unknown, token: string | null) {
  const ctx = await context(token);
  if (ctx === null) return denied();
  const started = await startWorkflowV2(
    ctx.db,
    ctx.actor,
    input,
    createWorkflowV2Adapters(),
    AbortSignal.timeout(15_000),
  );
  if (started.ok) await nudgeWorkflowV2Run(started.value.id);
  return result(started);
}
export async function readWorkflowV2RunAction(id: string) {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(await readWorkflowV2Run(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000)));
}
export async function listWorkflowV2RunsAction(id: string) {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(await listWorkflowV2Runs(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000)));
}
export async function cancelWorkflowV2RunAction(id: string, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(await cancelWorkflowV2Run(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000)));
}
export async function readWorkflowV2StudioAction() {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(
        await readWorkflowV2Studio(
          ctx.db,
          ctx.actor,
          createWorkflowV2Adapters(),
          AbortSignal.timeout(15_000),
        ),
      );
}
export async function lookupWorkflowV2RecordsAction(input: unknown) {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(await lookupWorkflowV2Records(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000)));
}
export async function testWorkflowV2DraftAction(input: unknown, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(
        await testWorkflowV2Draft(
          ctx.db,
          ctx.actor,
          input,
          createWorkflowV2Adapters(),
          AbortSignal.timeout(15_000),
        ),
      );
}
export async function listPendingWorkflowV2InputsAction() {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(await listPendingWorkflowV2Inputs(ctx.db, ctx.actor, AbortSignal.timeout(10_000)));
}
export async function readWorkflowV2FormAction(id: string) {
  const ctx = await context();
  return ctx === null
    ? denied()
    : result(await readWorkflowV2Form(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000)));
}
export async function resumeWorkflowV2FormAction(input: unknown, token: string | null) {
  const ctx = await context(token);
  if (ctx === null) return denied();
  const resumed = await resumeWorkflowV2Form(
    ctx.db,
    ctx.actor,
    input,
    createWorkflowV2Adapters(),
    AbortSignal.timeout(15_000),
  );
  if (resumed.ok) await nudgeWorkflowV2Run(resumed.value.runId);
  return result(resumed);
}
export async function rotateWorkflowV2WebhookAction(input: unknown, token: string | null) {
  const ctx = await context(token);
  return ctx === null
    ? denied()
    : result(await rotateWorkflowV2Webhook(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000)));
}
