import { type SQL, sql } from "drizzle-orm";
import type { PermSetUser } from "@/features/permissions/effective";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import { activityVisibilityPredicate } from "@/features/stats/activityVisibilitySql";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { activityQueuePayload, dealQueuePayload } from "./queueSqlProjection";
import type { NextActionQueueInput } from "./queueTypes";

function activityEndDay(zone: string): SQL {
  return sql`case when a.due_date is not null then coalesce(a.end_date, a.due_date)
    else (coalesce(a.end_at, a.due_at) at time zone ${zone}::text)::date end`;
}

function activitySortAt(zone: string): SQL {
  return sql`case when a.all_day then
    ((${activityEndDay(zone)} + 1)::timestamp at time zone ${zone}::text)
    else a.due_at end`;
}

function utcText(expression: SQL): SQL {
  return sql`pg_catalog.to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

function activityAnchor(zone: string): SQL {
  return sql`jsonb_build_object(
    'rule', 'overdue', 'activityId', a.id, 'dealId', d.id,
    'evidence', case when a.all_day then jsonb_build_object(
      'kind', 'final-civil-day', 'date', pg_catalog.to_char(${activityEndDay(zone)}, 'YYYY-MM-DD'),
      'basis', case when a.due_date is null then 'legacy-zoned' else 'recorded-civil' end
    ) else jsonb_build_object('kind', 'due-instant', 'at', ${utcText(sql`a.due_at`)}) end
  )`;
}

const dealAnchor = sql`jsonb_build_object(
  'rule', 'missing-next-step', 'dealId', d.id,
  'evidence', jsonb_build_object('kind', 'no-open-linked-activity')
)`;

// Internal adapter arguments only. The filter sees the canonical d/p aliases in both
// branches. It may narrow current authorized records and cannot replace either gate.
export interface NextActionDealReportScope {
  available: SQL;
  dealFilter: SQL;
  maxMatches: number;
}

export function nextActionQueueSql(
  actor: PermSetUser,
  input: NextActionQueueInput,
  asOf: string,
  timeZone: string,
): SQL {
  return queueSql(actor, input, asOf, timeZone);
}

export function nextActionDealReportSql(
  actor: PermSetUser,
  page: Pick<NextActionQueueInput, "limit" | "offset">,
  timeZone: string,
  report: NextActionDealReportScope,
  fixtureAsOf?: string,
): SQL {
  return queueSql(
    actor,
    { scope: "all-permitted", ...page },
    fixtureAsOf ?? null,
    timeZone,
    report,
  );
}

function queueSql(
  actor: PermSetUser,
  input: NextActionQueueInput,
  asOf: string | null,
  timeZone: string,
  report?: NextActionDealReportScope,
): SQL {
  const clock = asOf === null ? sql`pg_catalog.clock_timestamp()` : sql`${asOf}::timestamptz`;
  const threshold = report === undefined ? clock : sql`(select observed_at from report_scope)`;
  const today =
    report === undefined && asOf !== null
      ? sql`${instantCivilDate(asOf, timeZone)}::date`
      : sql`(${threshold} at time zone ${timeZone}::text)::date`;
  const reportCte =
    report === undefined
      ? sql``
      : sql`report_scope as materialized (
    select (${report.available}) is true as available, ${clock} as observed_at
  ), `;
  const reportFilter =
    report === undefined
      ? sql``
      : sql`
    and (select available from report_scope) and d.id is not null and (${report.dealFilter})
  `;
  const bound = report === undefined ? sql`` : sql`limit ${report.maxMatches + 1}`;
  const pageGate =
    report === undefined ? sql`` : sql`where (select total from totals) <= ${report.maxMatches}`;
  const reportMetadata =
    report === undefined
      ? sql``
      : sql`,
    (select available from report_scope) as "scopeAvailable",
    total > ${report.maxMatches} as limited,
    (select ${utcText(sql`observed_at`)} from report_scope) as "observedAt"
  `;
  const mineActivity = input.scope === "mine" ? sql`a.assignee_id = ${actor.id}::uuid` : sql`true`;
  const mineDeal = input.scope === "mine" ? sql`d.owner_id = ${actor.id}::uuid` : sql`true`;
  const dealVisible = dealVisibilityPredicate(
    {
      userId: actor.id,
      isAdmin: actor.type === "admin",
      isActive: actor.isActive,
      sessionLive: true,
      groupIds: [...actor.groupIds],
      managedUserIds: [...(actor.managedUserIds ?? [])],
    },
    {
      ownerId: sql`d.owner_id`,
      visibilityLevel: sql`d.visibility_level`,
      visibilityGroupId: sql`d.visibility_group_id`,
      visibleToUserIds: sql`d.visible_to_user_ids`,
      pipelineVisibilityGroupId: sql`p.visibility_group_id`,
    },
  );
  // One statement gives counts and the bounded page one authorized snapshot.
  // No raw-row LIMIT precedes dominant-parent authorization.
  return sql`with ${reportCte}activity_rows as (
    select 'overdue'::text as reason, 0 as tier, a.id,
      ${activitySortAt(timeZone)} as sort_at,
      ${report === undefined ? activityQueuePayload() : activityAnchor(timeZone)} as payload
    from activities a
    left join deals d on d.id = a.deal_id and d.deleted_at is null
    left join pipelines p on p.id = d.pipeline_id
    left join persons pe on pe.id = a.person_id and pe.deleted_at is null
    left join organizations o on o.id = a.org_id and o.deleted_at is null
    left join leads l on l.id = a.lead_id and l.deleted_at is null
    left join users au on au.id = a.assignee_id
    where a.deleted_at is null and not a.done and a.due_at is not null
      and ${activityVisibilityPredicate(actor, "a")}
      and (a.deal_id is null or d.archived_at is null)
      and ${mineActivity} ${reportFilter}
      and case when a.all_day then ${activityEndDay(timeZone)} < ${today}
        else a.due_at < ${threshold} end
  ), deal_rows as (
    select 'missing-next-step'::text as reason, 1 as tier, d.id,
      coalesce(d.last_activity_at, d.created_at) as sort_at, ${report === undefined ? dealQueuePayload() : dealAnchor} as payload
    from deals d join pipelines p on p.id = d.pipeline_id
    left join users ou on ou.id = d.owner_id
    left join persons pe on pe.id = d.person_id and pe.deleted_at is null
    left join organizations o on o.id = d.org_id and o.deleted_at is null
    where d.deleted_at is null and d.archived_at is null and d.status = 'open'
      and not p.is_archived and ${dealVisible} and ${mineDeal} ${reportFilter}
      and not exists (
        select 1 from activities pending where pending.deal_id = d.id
          and not pending.done and pending.deleted_at is null
      )
  ), authorized as (
    select * from activity_rows union all select * from deal_rows ${bound}
  ), totals as (
    select count(*)::int as total,
      (count(*) filter (where reason = 'overdue'))::int as overdue,
      (count(*) filter (where reason = 'missing-next-step'))::int as "missingNextStep"
    from authorized
  ), page as (
    select payload, tier, sort_at, id from authorized ${pageGate}
    order by tier, sort_at, id limit ${input.limit} offset ${input.offset}
  )
  select total, overdue, "missingNextStep",
    coalesce((select jsonb_agg(payload order by tier, sort_at, id) from page), '[]'::jsonb) as items ${reportMetadata}
  from totals`;
}
