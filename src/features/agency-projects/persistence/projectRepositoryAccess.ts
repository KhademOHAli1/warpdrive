import { and, eq } from "drizzle-orm";
import { err, ok } from "@/types/result";
import { checkProjectLocalAction, type ProjectLocalContext } from "../projectLocalAccess";
import { agencyProjectMembers, agencyProjects } from "./projectRepositoryTables";
import type { ProjectReadModel, ProjectTransactionContext } from "./projectRepositoryTypes";

export async function loadProject(
  context: ProjectTransactionContext,
  projectId: string,
  lock: boolean,
  signal: AbortSignal,
): Promise<ProjectReadModel | null> {
  signal.throwIfAborted();
  const query = context.db
    .select()
    .from(agencyProjects)
    .where(eq(agencyProjects.id, projectId))
    .limit(1);
  const rows = await (lock ? query.for("update") : query);
  signal.throwIfAborted();
  return rows[0] ?? null;
}

export async function authorizeProject(
  context: ProjectTransactionContext,
  projectId: string,
  action: "read" | "start" | "replay",
  signal: AbortSignal,
) {
  const project = await loadProject(context, projectId, action === "start", signal);
  if (project === null) return err("project_unavailable" as const);
  const rows = await context.db
    .select()
    .from(agencyProjectMembers)
    .where(
      and(
        eq(agencyProjectMembers.projectId, project.id),
        eq(agencyProjectMembers.userId, context.actor.id),
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  const admission = await context.authorizeProject(project, action, signal);
  signal.throwIfAborted();
  if (!admission.ok) return admission;
  const local: ProjectLocalContext = {
    actor: context.actor,
    projectId: project.id,
    ownerUserId: project.ownerUserId,
    membership: rows[0] ?? null,
  };
  // Start's pure transition helper performs its own local edit admission before revision details.
  if (action !== "start" && !checkProjectLocalAction(local, project, "read").ok)
    return err("project_unavailable" as const);
  return ok({ project, local });
}
