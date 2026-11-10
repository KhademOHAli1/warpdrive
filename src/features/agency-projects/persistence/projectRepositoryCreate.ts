import { err, type Result } from "@/types/result";
import type { ProjectCreateInput } from "../projectCreationInput";
import { planProjectCreation } from "../projectCreationPlan";
import { appendProjectHistory } from "./projectRepositoryHistory";
import {
  findProjectRequest,
  lockProjectIntent,
  replayContext,
  replayProjectRequest,
  storeProjectRequest,
} from "./projectRepositoryReplay";
import { agencyProjectMembers, agencyProjects } from "./projectRepositoryTables";
import type {
  ProjectReceipt,
  ProjectReplayCodec,
  ProjectRepositoryError,
  ProjectTransactionContext,
} from "./projectRepositoryTypes";

export async function createProject(
  context: ProjectTransactionContext,
  input: Readonly<ProjectCreateInput>,
  codec: ProjectReplayCodec,
  signal: AbortSignal,
): Promise<Result<ProjectReceipt, ProjectRepositoryError>> {
  await lockProjectIntent(context, "create", input.intentId, signal);
  const existing = await findProjectRequest(context, "create", input.intentId, signal);
  if (existing !== null) return replayProjectRequest(context, existing, input, codec, signal);
  const admission = await context.authorizeCreate(input, signal);
  signal.throwIfAborted();
  if (!admission.ok) return admission;
  if (admission.value.selectedOwner.id !== input.ownerUserId) return err("project_unavailable");
  const planned = planProjectCreation({ actor: context.actor, ...admission.value });
  if (!planned.ok) return err("project_unavailable");
  const plan = planned.value;
  const rows = await context.db
    .insert(agencyProjects)
    .values({
      title: input.title,
      ownerUserId: plan.ownerUserId,
      dealId: input.dealId,
      personId: input.personId,
      orgId: input.orgId,
      ...plan.initial,
    })
    .returning();
  signal.throwIfAborted();
  const project = rows[0];
  if (project === undefined) return err("project_unavailable");
  if (plan.creatorMembership !== null) {
    await context.db.insert(agencyProjectMembers).values({
      projectId: project.id,
      ...plan.creatorMembership,
    });
    signal.throwIfAborted();
  }
  const history = await appendProjectHistory(
    context,
    "create",
    project.id,
    null,
    plan.initial,
    signal,
  );
  if (!history.ok) return history;
  const binding = replayContext(
    context.actor.id,
    "create",
    input.intentId,
    project.id,
    plan.initial.revision,
    history.value,
  );
  return storeProjectRequest(context, binding, input, codec, signal);
}
