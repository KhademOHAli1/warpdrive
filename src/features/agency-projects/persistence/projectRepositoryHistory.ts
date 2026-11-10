import { err, ok } from "@/types/result";
import type { ProjectSnapshot } from "../projectLifecycle";
import { agencyProjectHistory } from "./projectRepositoryTables";
import type { ProjectReplayOperation, ProjectTransactionContext } from "./projectRepositoryTypes";

const PROJECT_HISTORY_POLICY_VERSION = 1;

export async function appendProjectHistory(
  context: ProjectTransactionContext,
  operation: ProjectReplayOperation,
  projectId: string,
  before: ProjectSnapshot | null,
  after: ProjectSnapshot,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const rows = await context.db
    .insert(agencyProjectHistory)
    .values({
      projectId,
      recordedByUserId: context.actor.id,
      operation,
      policyVersion: PROJECT_HISTORY_POLICY_VERSION,
      previousRevision: before?.revision ?? null,
      revision: after.revision,
      previousState: before?.state ?? null,
      state: after.state,
      previousArchivedFrom: before?.archivedFrom ?? null,
      archivedFrom: after.archivedFrom,
    })
    .returning({ id: agencyProjectHistory.id });
  signal.throwIfAborted();
  return rows[0] === undefined ? err("project_unavailable" as const) : ok(rows[0].id);
}
