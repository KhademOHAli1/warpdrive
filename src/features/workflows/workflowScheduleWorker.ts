import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema";
import {
  admitScheduledWorkflowOccurrence,
  type InsertScheduledWorkflowRun,
} from "./workflowScheduleAdmission";
import { readDueScheduledWorkflowPage } from "./workflowSchedulePoll";

export const workflowScheduleMaxPages = 20;

const insertScheduledRun: InsertScheduledWorkflowRun = async (tx, row) => {
  const [inserted] = await tx.insert(workflowRuns).values(row).returning({ id: workflowRuns.id });
  return inserted;
};

// The scanner pins one database UTC minute. A capped scan returns its cursor
// for the next tick, so very large installations do not always scan the head.
// Earlier minutes are never backfilled. The worker also applies a 45s deadline.
export async function dispatchWorkflowSchedules(
  db: Db,
  afterId: string | null,
  nudge: (runId: string) => Promise<void>,
  signal: AbortSignal,
): Promise<string | null> {
  let cursor = afterId;
  let minute: string | undefined;
  for (let pageNumber = 0; pageNumber < workflowScheduleMaxPages; pageNumber++) {
    signal.throwIfAborted();
    const page = await readDueScheduledWorkflowPage(db, cursor, signal, minute);
    if (page.scheduledAt === null) return null;
    if (minute !== undefined && page.scheduledAt !== minute) return cursor;
    minute = page.scheduledAt;
    for (const occurrence of page.occurrences) {
      const admitted = await admitScheduledWorkflowOccurrence(
        db,
        occurrence,
        insertScheduledRun,
        signal,
      );
      signal.throwIfAborted();
      if (admitted.ok) await nudge(admitted.value);
      else if (admitted.error === ERROR_IDS.WORKFLOW_WRITE_FAILED)
        throw new AppError(ERROR_IDS.WORKFLOW_WRITE_FAILED, "Workflow schedule admission failed");
    }
    cursor = page.nextAfterId;
    if (cursor === null) return null;
  }
  return cursor;
}
