import { and, eq, sql } from "drizzle-orm";
import { err, type Result } from "@/types/result";
import { transitionProjectForLocalActor } from "../projectLocalAccess";
import { authorizeProject } from "./projectRepositoryAccess";
import { appendProjectHistory } from "./projectRepositoryHistory";
import {
  findProjectRequest,
  lockProjectIntent,
  replayContext,
  replayProjectRequest,
  storeProjectRequest,
} from "./projectRepositoryReplay";
import { agencyProjects } from "./projectRepositoryTables";
import type {
  ProjectReceipt,
  ProjectReplayCodec,
  ProjectRepositoryError,
  ProjectStartInput,
  ProjectTransactionContext,
} from "./projectRepositoryTypes";

export async function startProject(
  context: ProjectTransactionContext,
  input: ProjectStartInput,
  codec: ProjectReplayCodec,
  signal: AbortSignal,
): Promise<Result<ProjectReceipt, ProjectRepositoryError>> {
  await lockProjectIntent(context, "start", input.intentId, signal);
  const existing = await findProjectRequest(context, "start", input.intentId, signal);
  if (existing !== null) return replayProjectRequest(context, existing, input, codec, signal);
  const admission = await authorizeProject(context, input.projectId, "start", signal);
  if (!admission.ok) return admission;
  const { project, local } = admission.value;
  const transition = transitionProjectForLocalActor(local, project, {
    action: "start",
    expectedRevision: input.expectedRevision,
  });
  if (!transition.ok) {
    const error = transition.error;
    return err(
      error === "revision_conflict" ||
        error === "invalid_transition" ||
        error === "revision_exhausted"
        ? error
        : "project_unavailable",
    );
  }
  const { next } = transition.value;
  const updated = await context.db
    .update(agencyProjects)
    .set({
      ...next,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(agencyProjects.id, project.id), eq(agencyProjects.revision, input.expectedRevision)),
    )
    .returning({ id: agencyProjects.id });
  signal.throwIfAborted();
  if (updated[0] === undefined) return err("revision_conflict");
  const history = await appendProjectHistory(context, "start", project.id, project, next, signal);
  if (!history.ok) return history;
  const binding = replayContext(
    context.actor.id,
    "start",
    input.intentId,
    project.id,
    next.revision,
    history.value,
  );
  return storeProjectRequest(context, binding, input, codec, signal);
}
