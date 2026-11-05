"use server";

import { requireFreshIdentityAction } from "@/features/identity/actions/fresh";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { readWorkflowRuntime, saveWorkflowLogicFunction, saveWorkflowRuntime } from "./runtime";

async function authorized(token: string | null) {
  if (!(await guardCsrf(token)).ok) return null;
  const ctx = await createContext();
  if (ctx.actor?.type !== "admin" || !(await requireFreshIdentityAction()).ok) return null;
  return { db: ctx.db, actor: ctx.actor };
}
const denied = () => ({ ok: false as const, error: { id: "E_PERM_001" } });
export async function saveWorkflowRuntimeAction(input: unknown, token: string | null) {
  const ctx = await authorized(token);
  if (ctx === null) return denied();
  const result = await saveWorkflowRuntime(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
  return result.ok ? result : { ok: false as const, error: { id: result.error } };
}
export async function saveWorkflowLogicFunctionAction(input: unknown, token: string | null) {
  const ctx = await authorized(token);
  if (ctx === null) return denied();
  const signal = AbortSignal.timeout(10_000);
  const saved = await saveWorkflowLogicFunction(ctx.db, ctx.actor, input, signal);
  if (!saved.ok) return { ok: false as const, error: { id: saved.error } };
  const result = await readWorkflowRuntime(ctx.db, ctx.actor, signal);
  return result.ok ? result : { ok: false as const, error: { id: result.error } };
}
