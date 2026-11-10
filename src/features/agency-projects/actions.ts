"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { err } from "@/types/result";
import { createNativeProjectRepository } from "./nativeProject";
import { listNativeProjects } from "./nativeProjectList";
import { enableNativeProjects, projectCreationOptions, projectWorkspace } from "./nativeViews";
import { projectStartInputSchema } from "./persistence/projectStartInput";
import { projectCreateInputSchema } from "./projectCreationInput";
import type { ProjectCreationOutcome } from "./projectCreationUiTypes";
import type { ProjectStartOutcome } from "./projectWorkspaceTypes";

async function actionContext(expectedActorId: string) {
  const parsed = z.string().uuid().safeParse(expectedActorId);
  if (!parsed.success) return null;
  const context = await createContext();
  return context.actor?.id === parsed.data && context.session !== null ? context.session : null;
}
export async function createAgencyProjectAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectCreationOutcome> {
  if (!(await guardCsrf(csrfToken)).ok) return err("unknown");
  const who = await actionContext(expectedActorId);
  const parsed = projectCreateInputSchema.safeParse(raw);
  if (who === null || !parsed.success) return err("unknown");
  const result = await createNativeProjectRepository(db, who).create(
    parsed.data,
    AbortSignal.timeout(10_000),
  );
  return result.ok ? { ok: true, value: { projectId: result.value.projectId } } : err("unknown");
}
export async function startAgencyProjectAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectStartOutcome> {
  if (!(await guardCsrf(csrfToken)).ok) return err("unknown");
  const who = await actionContext(expectedActorId);
  const parsed = projectStartInputSchema.safeParse(raw);
  if (who === null || !parsed.success) return err("unknown");
  const result = await createNativeProjectRepository(db, who).start(
    parsed.data,
    AbortSignal.timeout(10_000),
  );
  if (result.ok) return result;
  return err(result.error === "revision_conflict" ? "conflict" : "unknown");
}
export async function listAgencyProjectsAction(expectedActorId: string, raw: unknown) {
  const who = await actionContext(expectedActorId);
  return who === null
    ? err("project_unavailable" as const)
    : listNativeProjects(db, who, raw, AbortSignal.timeout(10_000));
}
export async function readAgencyProjectAction(expectedActorId: string, raw: unknown) {
  const who = await actionContext(expectedActorId);
  const parsed = z.string().uuid().safeParse(raw);
  return who === null || !parsed.success
    ? err("project_unavailable" as const)
    : projectWorkspace(db, who, parsed.data, AbortSignal.timeout(10_000));
}
export async function agencyProjectOptionsAction(expectedActorId: string, raw: unknown) {
  const who = await actionContext(expectedActorId);
  const query = z.string().trim().max(120).safeParse(raw);
  return who === null || !query.success
    ? err("project_unavailable" as const)
    : projectCreationOptions(db, who, query.data, AbortSignal.timeout(10_000));
}
export async function enableAgencyProjectsAction(
  expectedActorId: string,
  enabled: boolean,
  csrfToken: string | null,
) {
  if (!(await guardCsrf(csrfToken)).ok || typeof enabled !== "boolean")
    return err("project_unavailable" as const);
  const who = await actionContext(expectedActorId);
  return who === null
    ? err("project_unavailable" as const)
    : enableNativeProjects(db, who, enabled, AbortSignal.timeout(10_000));
}
