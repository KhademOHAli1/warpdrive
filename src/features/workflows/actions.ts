"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { requireFreshIdentityAction } from "@/features/identity/actions/fresh";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { err } from "@/types/result";
import { simulateWorkflowDraft } from "./draftSimulation";
import {
  archiveWorkflow,
  duplicateWorkflow,
  restoreWorkflowDraft,
  unarchiveWorkflow,
} from "./lifecycle";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";
import { pauseWorkflow } from "./queries";
import { nudgeWorkflowRun } from "./queue";
import { admitManualRun } from "./runAdmission";
import { cancelWorkflowRun } from "./runControl";
import { retryWorkflowRun } from "./runRetry";
import { submitWorkflowHumanForm } from "./workflowHumanFormSubmit";

async function authorizedContext(token: string | null) {
  const csrf = await guardCsrf(token);
  if (!csrf.ok) return null;
  const ctx = await createContext();
  return ctx.actor === null ? null : { db: ctx.db, actor: ctx.actor, session: ctx.session };
}

export async function archiveWorkflowAction(input: unknown, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return archiveWorkflow(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
}
export async function unarchiveWorkflowAction(input: unknown, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return unarchiveWorkflow(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
}
export async function duplicateWorkflowAction(
  input: unknown,
  token: string | null,
): ReturnType<typeof duplicateWorkflow> {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return duplicateWorkflow(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
}
export async function restoreWorkflowDraftAction(input: unknown, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return restoreWorkflowDraft(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
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
  const fresh = await requireFreshIdentityAction();
  if (!fresh.ok) return fresh;
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

export async function simulateWorkflowDraftAction(
  input: unknown,
  token: string | null,
): ReturnType<typeof simulateWorkflowDraft> {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return simulateWorkflowDraft(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
}

export async function cancelWorkflowAction(id: string, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  return cancelWorkflowRun(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000));
}

export async function retryWorkflowAction(input: unknown, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null || ctx.session == null || ctx.session.userId !== ctx.actor.id)
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const result = await retryWorkflowRun(ctx.db, ctx.session, input, AbortSignal.timeout(10_000));
  if (result.ok) await nudgeWorkflowRun(result.value.id);
  return result.ok ? { ok: true as const, value: { id: result.value.id } } : result;
}

export async function submitWorkflowHumanFormAction(input: unknown, token: string | null) {
  const ctx = await authorizedContext(token);
  if (ctx === null || ctx.session == null || ctx.session.userId !== ctx.actor.id)
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const result = await submitWorkflowHumanForm(
    ctx.db,
    ctx.session,
    input,
    AbortSignal.timeout(10_000),
  );
  if (result.ok) await nudgeWorkflowRun(result.value.id);
  return result.ok ? { ok: true as const, value: { id: result.value.id } } : result;
}
