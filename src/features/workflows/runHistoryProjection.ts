import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, type workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import type { RunHistoryItem } from "./runHistoryTypes";
import { describeRunRecovery, readFailureHistories } from "./runRecovery";

export const runHistorySelection = {
  id: workflowRuns.id,
  status: workflowRuns.status,
  mode: workflowRuns.mode,
  resumeAt: workflowRuns.resumeAt,
  versionId: workflowRuns.versionId,
  errorId: workflowRuns.errorId,
  createdAt: workflowRuns.createdAt,
  updatedAt: workflowRuns.updatedAt,
  run: workflowRuns,
  definition: workflowVersions.definition,
};

export type RunHistorySourceRow = Pick<
  RunHistoryItem,
  "id" | "status" | "mode" | "resumeAt" | "versionId" | "errorId" | "createdAt" | "updatedAt"
> & {
  run: typeof workflowRuns.$inferSelect;
  definition: (typeof workflowVersions.$inferSelect)["definition"] | null;
};

// The caller has already authorized this workflow and bounded the displayed rows.
// Internal run/version data is used only for the existing recovery authority checks.
export async function hydrateRunHistoryRows(
  db: Db,
  actor: PermSetUser,
  workflow: typeof workflows.$inferSelect,
  rows: readonly RunHistorySourceRow[],
  signal: AbortSignal,
): Promise<RunHistoryItem[]> {
  signal.throwIfAborted();
  const failures = await readFailureHistories(
    db,
    rows.map((row) => row.id),
    signal,
  );
  const history = await Promise.all(
    rows.map(async (source) => {
      const steps = await db
        .select()
        .from(workflowSteps)
        .where(and(eq(workflowSteps.runId, source.id), eq(workflowSteps.outcome, "succeeded")))
        .orderBy(workflowSteps.completedAt);
      const recovery = await describeRunRecovery(
        db,
        actor,
        workflow,
        source.run,
        source.definition,
        steps,
        failures.get(source.id) ?? [],
        signal,
      );
      // Explicit DTO selection also excludes any page-only cursor projection.
      return {
        id: source.id,
        status: source.status,
        mode: source.mode,
        resumeAt: source.resumeAt,
        versionId: source.versionId,
        errorId: source.errorId,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        steps: steps.map(({ nodeId, simulated, completedAt }) => ({
          nodeId,
          simulated,
          completedAt,
        })),
        ...(recovery === null ? {} : { recovery }),
      };
    }),
  );
  signal.throwIfAborted();
  return history;
}
