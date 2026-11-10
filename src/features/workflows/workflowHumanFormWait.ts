import { eq } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema";
import { err, ok } from "@/types/result";

const responseWindowMs = 7 * 24 * 60 * 60 * 1000;

// The worker holds the run lock. A waiting form has no completed step until
// the authenticated submission atomically records the response and next cursor.
export async function advanceWorkflowHumanForm(
  db: Db,
  run: Pick<typeof workflowRuns.$inferSelect, "id" | "mode" | "status" | "resumeAt">,
  now: Date,
  signal: AbortSignal,
) {
  if (run.mode !== "live") return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (run.status === "waiting") {
    const time = run.resumeAt?.getTime();
    if (time === undefined || !Number.isFinite(time)) return err(ERROR_IDS.WORKFLOW_INVALID);
    return time > now.getTime()
      ? ok({ status: "waiting" as const })
      : err(ERROR_IDS.WORKFLOW_FORM_EXPIRED);
  }
  const deadline = new Date(now.getTime() + responseWindowMs);
  if (!Number.isFinite(deadline.getTime())) return err(ERROR_IDS.WORKFLOW_INVALID);
  await db
    .update(workflowRuns)
    .set({ status: "waiting", resumeAt: deadline, updatedAt: now })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok({ status: "waiting" as const, armedDeadline: deadline });
}
