"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { err } from "@/types/result";
import type { PipelineLifecycleResult } from "./lifecycleTypes";
import { setPipelineArchived } from "./pipelineLifecycle";

async function applyState(
  raw: unknown,
  csrf: string | null,
  archived: boolean,
): Promise<PipelineLifecycleResult> {
  const guard = await guardCsrf(csrf);
  if (!guard.ok) return err("denied");
  if (!env.SALES_PIPELINE_LIFECYCLE_ENABLED) return err("unavailable");
  const result = await setPipelineArchived(db, await headers(), raw, archived, SIG());
  if (result.ok) {
    revalidatePath("/settings/company/pipelines");
    revalidatePath("/pipeline");
  }
  return result;
}

export async function archivePipelineAction(
  raw: unknown,
  csrf: string | null = null,
): Promise<PipelineLifecycleResult> {
  return applyState(raw, csrf, true);
}

export async function restorePipelineAction(
  raw: unknown,
  csrf: string | null = null,
): Promise<PipelineLifecycleResult> {
  return applyState(raw, csrf, false);
}
