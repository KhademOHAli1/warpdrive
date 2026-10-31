"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { err } from "@/types/result";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";
import { pauseWorkflow } from "./queries";
import { admitManualRun } from "./runAdmission";
import { cancelWorkflowRun } from "./runControl";
import { nudgeWorkflowRun } from "./worker";

async function authorizedContext(token: string | null) {
  const csrf = await guardCsrf(token);
  if (!csrf.ok) return null;
  const ctx = await createContext();
  return ctx.actor === null ? null : { db: ctx.db, actor: ctx.actor };
}

export async function createWorkflowAction(input: unknown, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return createWorkflow(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
}
export async function saveWorkflowAction(input: unknown, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return saveWorkflowDraft(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
}
export async function publishWorkflowAction(id: string, revision: number, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return publishWorkflow(ctx.db, ctx.actor, id, revision, AbortSignal.timeout(10_000));
}
export async function pauseWorkflowAction(id: string, revision: number, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return pauseWorkflow(ctx.db, ctx.actor, id, revision, AbortSignal.timeout(10_000));
}
export async function runWorkflowAction(input: unknown, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  const result = await admitManualRun(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
  if (result.ok) await nudgeWorkflowRun(result.value.id);
  return result.ok ? { ok: true as const, value: { id: result.value.id } } : result;
}
export async function cancelWorkflowAction(id: string, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return cancelWorkflowRun(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000));
}
