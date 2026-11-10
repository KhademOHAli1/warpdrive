import type { workflowRuns } from "@/db/schema";
import type { WorkflowDefinition } from "./schemas";
import { type WorkflowHumanFormConfig, workflowHumanFormConfig } from "./workflowHumanFormContract";

export type PendingWorkflowHumanForm = WorkflowHumanFormConfig & {
  nodeId: string;
  deadline: Date;
};

export function pendingWorkflowHumanForm(
  run: Pick<
    typeof workflowRuns.$inferSelect,
    "status" | "mode" | "actorId" | "nextNodeId" | "resumeAt"
  >,
  definition: WorkflowDefinition,
  viewerId: string,
  viewerCanRun: boolean,
): PendingWorkflowHumanForm | undefined {
  if (
    !viewerCanRun ||
    viewerId !== run.actorId ||
    run.mode !== "live" ||
    run.status !== "waiting" ||
    run.resumeAt === null
  )
    return undefined;
  const node = definition.nodes.find((entry) => entry.id === run.nextNodeId);
  if (node?.type !== "human.form" || !Number.isFinite(run.resumeAt.getTime())) return undefined;
  const parsed = workflowHumanFormConfig.safeParse(node.config);
  return parsed.success ? { ...parsed.data, nodeId: node.id, deadline: run.resumeAt } : undefined;
}
