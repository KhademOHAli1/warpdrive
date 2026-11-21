import type { z } from "zod";
import { type Db, db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { guardCsrf } from "@/features/identity/actions/shared";
import { revalidatePath } from "@/server/request";
import { createContext } from "@/server/trpc/context";
import { err } from "@/types/result";
import type { ProjectResult } from "../contracts";
import { projectIdInput } from "../input";
import type { ProjectWorkStructure } from "./contracts";
import { saveProjectEstimateScale, setProjectEstimateScale } from "./estimates";
import {
  saveProjectEstimateScaleInput,
  saveProjectLabelsInput,
  setProjectEstimateScaleInput,
} from "./input";
import { saveProjectLabels } from "./labels";

async function runStructureCommand<Input extends { projectId: string }>(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
  schema: z.ZodType<Input>,
  write: (
    db: Db,
    session: NativeSessionRef,
    input: Input,
    signal: AbortSignal,
  ) => Promise<ProjectResult<ProjectWorkStructure>>,
): Promise<ProjectResult<ProjectWorkStructure>> {
  if (typeof csrfToken !== "string" || !(await guardCsrf(csrfToken)).ok)
    return err("project_forbidden");
  const actorId = projectIdInput.safeParse(expectedActorId);
  if (!actorId.success) return err("project_unavailable");
  const context = await createContext();
  if (context.session === null || context.actor?.id !== actorId.data)
    return err("project_unavailable");
  const input = schema.safeParse(raw);
  if (!input.success) return err("project_invalid");
  const result = await write(db, context.session, input.data, AbortSignal.timeout(10_000));
  if (result.ok) {
    const root = `/projects/internal/${input.data.projectId}`;
    revalidatePath(root);
    revalidatePath(`${root}/settings/labels`);
    revalidatePath(`${root}/settings/estimates`);
  }
  return result;
}

export function saveProjectLabelsAction(actorId: string, raw: unknown, csrfToken: string | null) {
  return runStructureCommand(actorId, raw, csrfToken, saveProjectLabelsInput, saveProjectLabels);
}

export function saveProjectEstimateScaleAction(
  actorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runStructureCommand(
    actorId,
    raw,
    csrfToken,
    saveProjectEstimateScaleInput,
    saveProjectEstimateScale,
  );
}

export function setProjectEstimateScaleAction(
  actorId: string,
  raw: unknown,
  csrfToken: string | null,
) {
  return runStructureCommand(
    actorId,
    raw,
    csrfToken,
    setProjectEstimateScaleInput,
    setProjectEstimateScale,
  );
}
