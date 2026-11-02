"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import {
  createPipelineWithStages,
  createStage,
  renamePipeline,
  reorderStages,
} from "./pipelineActions";
import type {
  PipelineCreateInput,
  StageCreateInput,
  StageDeleteInput,
  StageReorderInput,
  StageUpdateInput,
} from "./schemas";
import { deleteStage, updateStage } from "./stageActions";

// Thin CSRF-guarded wrappers around the pure pipeline/stage mutation functions, for the Edit
// Pipeline page. Rename uses native fresh proof and transaction-time scope/revision checks.
// Create/stage actions retain their current actor projection. Every wrapper guards CSRF first;
// client input never carries the permission decision.
export type EditResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: { id: string } };

interface ManageSession {
  userId: string;
  isAdmin: boolean;
  flags: Record<string, boolean>;
}

// Resolves the current actor into a ManageSession, or an auth/csrf error result. Returns a
// discriminated union so callers can early-return on the failure branch.
async function authorize(
  csrfToken: string | null,
): Promise<{ ok: true; session: ManageSession } | { ok: false; error: { id: string } }> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: "E_AUTH_003" } };
  const flags: Record<string, boolean> = {};
  for (const f of actor.flags) flags[f] = true;
  return {
    ok: true,
    session: { userId: actor.id, isAdmin: actor.type === "admin", flags },
  };
}

export async function createPipelineAction(
  input: PipelineCreateInput,
  csrfToken: string | null = null,
): Promise<EditResult<{ id: string; name: string }>> {
  const auth = await authorize(csrfToken);
  if (!auth.ok) return auth;
  const r = await createPipelineWithStages(db, auth.session, input, SIG());
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return { ok: true, value: { id: r.value.id, name: r.value.name } };
}

export async function renamePipelineAction(
  input: unknown,
  csrfToken: string | null = null,
): Promise<EditResult<{ id: string; name: string; updatedAt: string }>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const r = await renamePipeline(db, await headers(), input, SIG());
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  revalidatePath("/settings/company/pipelines");
  revalidatePath("/pipeline");
  return {
    ok: true,
    value: { id: r.value.id, name: r.value.name, updatedAt: r.value.updatedAt.toISOString() },
  };
}

export async function createStageAction(
  input: StageCreateInput,
  csrfToken: string | null = null,
): Promise<EditResult<{ id: string }>> {
  const auth = await authorize(csrfToken);
  if (!auth.ok) return auth;
  const r = await createStage(db, auth.session, input, SIG());
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return { ok: true, value: { id: r.value.id } };
}

export async function updateStageAction(
  input: StageUpdateInput,
  csrfToken: string | null = null,
): Promise<EditResult<{ id: string }>> {
  const auth = await authorize(csrfToken);
  if (!auth.ok) return auth;
  const r = await updateStage(db, auth.session, input, SIG());
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return { ok: true, value: { id: r.value.id } };
}

export async function deleteStageAction(
  input: StageDeleteInput,
  csrfToken: string | null = null,
): Promise<EditResult> {
  const auth = await authorize(csrfToken);
  if (!auth.ok) return auth;
  const r = await deleteStage(db, auth.session, input, SIG());
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return { ok: true, value: undefined };
}

export async function reorderStagesAction(
  input: StageReorderInput,
  csrfToken: string | null = null,
): Promise<EditResult> {
  const auth = await authorize(csrfToken);
  if (!auth.ok) return auth;
  const r = await reorderStages(db, auth.session, input, SIG());
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return { ok: true, value: undefined };
}
