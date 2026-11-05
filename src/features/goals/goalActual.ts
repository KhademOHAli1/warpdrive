// What a goal has actually booked inside one period.
//
// Two scopes are at play and they are not the same: the goal names WHOSE work counts (a user,
// a team's members, or everyone), while the viewer's own visibility still decides which deals
// they are allowed to see at all. Reading a colleague's goal must never surface a deal that
// colleague can see and the viewer cannot.

import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { Goal } from "@/db/schema/goals";
import { dealVisibilityClause } from "@/features/deals/visibility";
import type { PermSetUser } from "@/features/permissions/effective";
import { activityVisibilityPredicate } from "@/features/stats/activityVisibilitySql";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { GoalPeriod } from "./goalPeriod";
import {
  activityEvent,
  activityTypeClause,
  assigneeClause,
  dealEvent,
  goalSession,
  pipelineClause,
} from "./goalSql";

interface Totals {
  count: number;
  value: string;
  missingEventDateCount: number;
}

async function dealTotals(
  db: Db,
  actor: PermSetUser,
  goal: Goal,
  period: GoalPeriod,
  signal: AbortSignal,
): Promise<Totals> {
  const from = sql`${period.start}::date`;
  const toExclusive = sql`${period.end}::date + INTERVAL '1 day'`;
  const { at, state } = dealEvent(goal);
  const inPeriod = sql`${at} >= ${from} AND ${at} < ${toExclusive}`;
  const undated = goal.action === "won" || goal.action === "lost" ? sql`${at} IS NULL` : sql`false`;

  const result = await db.execute(sql`
    SELECT count(*) FILTER (WHERE ${inPeriod})::int AS "count",
           coalesce(sum(d.value) FILTER (WHERE ${inPeriod}), 0)::text AS "value",
           count(*) FILTER (WHERE ${undated})::int AS "missingEventDateCount"
    FROM deals d
    JOIN pipelines p ON p.id = d.pipeline_id
    WHERE d.deleted_at IS NULL
      AND d.archived_at IS NULL
      AND p.is_archived = false
      AND ${state} ((${inPeriod}) OR (${undated}))
      ${goal.metric === "value" ? sql`AND d.currency = ${goal.currency}` : sql``}
      ${pipelineClause(goal, sql`d.pipeline_id`)}
      ${assigneeClause(goal, sql`d.owner_id`)}
      AND ${dealVisibilityClause(goalSession(actor))}
  `);
  signal.throwIfAborted();
  const row = (result as unknown as { rows: Totals[] }).rows[0];
  return {
    count: row?.count ?? 0,
    value: canonicalMoney(row?.value ?? "0.00"),
    missingEventDateCount: row?.missingEventDateCount ?? 0,
  };
}

async function activityTotals(
  db: Db,
  actor: PermSetUser,
  goal: Goal,
  period: GoalPeriod,
  signal: AbortSignal,
): Promise<Totals> {
  const from = sql`${period.start}::date`;
  const toExclusive = sql`${period.end}::date + INTERVAL '1 day'`;
  const { at, state } = activityEvent(goal);
  const inPeriod = sql`${at} >= ${from} AND ${at} < ${toExclusive}`;
  const undated = goal.action === "completed" ? sql`${at} IS NULL` : sql`false`;
  const dealPipelineClause =
    goal.pipelineId !== null
      ? sql`AND EXISTS (
          SELECT 1 FROM deals d3 WHERE d3.id = a.deal_id AND d3.pipeline_id = ${goal.pipelineId}
        )`
      : sql``;

  const result = await db.execute(sql`
    SELECT count(*) FILTER (WHERE ${inPeriod})::int AS "count",
           count(*) FILTER (WHERE ${undated})::int AS "missingEventDateCount"
    FROM activities a
    WHERE a.deleted_at IS NULL
      AND ${state} ((${inPeriod}) OR (${undated}))
      ${activityTypeClause(goal)}
      ${dealPipelineClause}
      ${assigneeClause(goal, sql`a.assignee_id`)}
      AND ${activityVisibilityPredicate(actor, "a")}
  `);
  signal.throwIfAborted();
  const row = (result as unknown as { rows: { count: number; missingEventDateCount: number }[] }).rows[0];
  return { count: row?.count ?? 0, value: "0.00", missingEventDateCount: row?.missingEventDateCount ?? 0 };
}

export interface GoalActualQuality {
  actual: string;
  missingMeasurementDateCount: number;
}

// Known-period totals and undated eligible events share one SQL snapshot and visibility gate.
export async function goalActualWithQuality(
  db: Db,
  actor: PermSetUser,
  goal: Goal,
  period: GoalPeriod,
  signal: AbortSignal,
): Promise<GoalActualQuality> {
  signal.throwIfAborted();
  const totals =
    goal.subject === "deal"
      ? await dealTotals(db, actor, goal, period, signal)
      : await activityTotals(db, actor, goal, period, signal);
  return {
    actual: goal.metric === "value" ? totals.value : String(totals.count),
    missingMeasurementDateCount: totals.missingEventDateCount,
  };
}

// Preserve the decimal-string contract used by reports and existing callers.
export async function goalActual(
  db: Db,
  actor: PermSetUser,
  goal: Goal,
  period: GoalPeriod,
  signal: AbortSignal,
): Promise<string> {
  return (await goalActualWithQuality(db, actor, goal, period, signal)).actual;
}
