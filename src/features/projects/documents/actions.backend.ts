import type { z } from "zod";
import { type Db, db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { guardCsrf } from "@/features/identity/actions/shared";
import { revalidatePath } from "@/server/request";
import { createContext } from "@/server/trpc/context";
import { err } from "@/types/result";
import type { ProjectResult } from "../contracts";
import { projectIdInput } from "../input";
import type { ProjectDocumentDetail } from "./contracts";
import {
  createProjectDocumentInput,
  restoreProjectDocumentVersionInput,
  saveProjectDocumentInput,
  setProjectDocumentLifecycleInput,
} from "./input";
import {
  createProjectDocument,
  restoreProjectDocumentVersion,
  saveProjectDocument,
  setProjectDocumentLifecycle,
} from "./service";

async function runDocumentAction<Input extends { projectId: string }>(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
  schema: z.ZodType<Input>,
  command: (
    sourceDb: Db,
    session: NativeSessionRef,
    input: Input,
    signal: AbortSignal,
  ) => Promise<ProjectResult<ProjectDocumentDetail>>,
): Promise<ProjectResult<ProjectDocumentDetail>> {
  if (typeof csrfToken !== "string" || !(await guardCsrf(csrfToken)).ok)
    return err("project_forbidden");
  const actorId = projectIdInput.safeParse(expectedActorId);
  if (!actorId.success) return err("project_unavailable");
  const context = await createContext();
  if (context.session === null || context.actor?.id !== actorId.data)
    return err("project_unavailable");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return err("project_invalid");
  const result = await command(db, context.session, parsed.data, AbortSignal.timeout(10_000));
  if (result.ok) {
    const documentRoot = `/projects/internal/${parsed.data.projectId}/documents`;
    revalidatePath(documentRoot);
    revalidatePath(`${documentRoot}/${result.value.document.id}`);
  }
  return result;
}

export function createProjectDocumentAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runDocumentAction(
    expectedActorId,
    raw,
    csrfToken,
    createProjectDocumentInput,
    createProjectDocument,
  );
}

export function saveProjectDocumentAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runDocumentAction(
    expectedActorId,
    raw,
    csrfToken,
    saveProjectDocumentInput,
    saveProjectDocument,
  );
}

export function setProjectDocumentLifecycleAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runDocumentAction(
    expectedActorId,
    raw,
    csrfToken,
    setProjectDocumentLifecycleInput,
    setProjectDocumentLifecycle,
  );
}

export function restoreProjectDocumentVersionAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runDocumentAction(
    expectedActorId,
    raw,
    csrfToken,
    restoreProjectDocumentVersionInput,
    restoreProjectDocumentVersion,
  );
}
