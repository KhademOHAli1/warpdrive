import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { workflows, workflowVersions } from "@/db/schema";
import type { WorkflowScheduleOccurrence } from "./workflowScheduleAdmission";
import {
  readWorkflowScheduleTrigger,
  workflowScheduleMatches,
  workflowScheduleMinute,
} from "./workflowScheduleContract";

const PAGE_SIZE = 50;

export interface ScheduledWorkflowPage {
  occurrences: WorkflowScheduleOccurrence[];
  nextAfterId: string | null;
  scheduledAt: string | null;
}

// Enumerate active publications in stable, bounded pages. Discovery is only a
// hint. Admission rechecks the owner, publication and clock under a row lock.
export async function readDueScheduledWorkflowPage(
  db: Db,
  afterId: string | null,
  signal: AbortSignal,
  expectedMinute?: string,
): Promise<ScheduledWorkflowPage> {
  signal.throwIfAborted();
  const rows = await db
    .select({
      workflowId: workflows.id,
      versionId: workflowVersions.id,
      publishedAt: workflowVersions.createdAt,
      definition: workflowVersions.definition,
      nowMs: sql<number>`extract(epoch from statement_timestamp())::double precision * 1000`,
    })
    .from(workflows)
    .innerJoin(
      workflowVersions,
      and(
        eq(workflows.id, workflowVersions.workflowId),
        eq(workflows.publishedNumber, workflowVersions.number),
      ),
    )
    .where(
      and(
        eq(workflows.active, true),
        isNull(workflows.archivedAt),
        afterId === null ? undefined : gt(workflows.id, afterId),
        sql`${workflowVersions.definition} @> '{"nodes":[{"type":"trigger.schedule"}]}'::jsonb`,
      ),
    )
    .orderBy(asc(workflows.id))
    .limit(PAGE_SIZE);
  signal.throwIfAborted();
  const scheduledAt = workflowScheduleMinute(rows[0]?.nowMs ?? Number.NaN);
  if (expectedMinute !== undefined && scheduledAt !== expectedMinute)
    return { occurrences: [], nextAfterId: null, scheduledAt };
  const occurrences: WorkflowScheduleOccurrence[] = [];
  if (scheduledAt !== null) {
    const dueMs = Date.parse(scheduledAt);
    for (const row of rows) {
      if (row.publishedAt.getTime() > dueMs) continue;
      const trigger = readWorkflowScheduleTrigger(row.definition);
      if (trigger === null || !workflowScheduleMatches(trigger.config, scheduledAt)) continue;
      occurrences.push({ workflowId: row.workflowId, versionId: row.versionId, scheduledAt });
    }
  }
  const nextAfterId = rows.length === PAGE_SIZE ? (rows.at(-1)?.workflowId ?? null) : null;
  return { occurrences, nextAfterId, scheduledAt };
}
