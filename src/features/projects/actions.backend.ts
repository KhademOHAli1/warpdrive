import type { z } from "zod";
import { type Db, db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { guardCsrf } from "@/features/identity/actions/shared";
import { revalidatePath } from "@/server/request";
import { createContext } from "@/server/trpc/context";
import { err } from "@/types/result";
import type { ProjectResult } from "./contracts";
import {
  createProjectInput,
  createProjectItemInput,
  projectIdInput,
  setProjectMemberInput,
  updateProjectItemInput,
} from "./input";
import {
  createInternalProject,
  createInternalProjectItem,
  setInternalProjectMember,
  updateInternalProjectItem,
} from "./service";

async function runProjectAction<Input, Output>(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
  schema: z.ZodType<Input>,
  command: (
    db: Db,
    session: NativeSessionRef,
    input: Input,
    signal: AbortSignal,
  ) => Promise<ProjectResult<Output>>,
): Promise<ProjectResult<Output>> {
  if (typeof csrfToken !== "string" || !(await guardCsrf(csrfToken)).ok)
    return err("project_forbidden");
  const actorId = projectIdInput.safeParse(expectedActorId);
  if (!actorId.success) return err("project_unavailable");
  const context = await createContext();
  if (context.session === null || context.actor?.id !== actorId.data)
    return err("project_unavailable");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return err("project_invalid");
  return command(db, context.session, parsed.data, AbortSignal.timeout(10_000));
}

export async function createProjectAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  const result = await runProjectAction(
    expectedActorId,
    raw,
    csrfToken,
    createProjectInput,
    createInternalProject,
  );
  if (result.ok) revalidatePath("/projects/internal");
  return result;
}

export function createProjectItemAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runProjectAction(
    expectedActorId,
    raw,
    csrfToken,
    createProjectItemInput,
    createInternalProjectItem,
  );
}

export function updateProjectItemAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runProjectAction(
    expectedActorId,
    raw,
    csrfToken,
    updateProjectItemInput,
    updateInternalProjectItem,
  );
}

export function setProjectMemberAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runProjectAction(
    expectedActorId,
    raw,
    csrfToken,
    setProjectMemberInput,
    setInternalProjectMember,
  );
}
