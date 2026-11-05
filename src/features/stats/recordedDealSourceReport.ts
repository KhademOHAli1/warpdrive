import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import { SOURCE_CHANNEL_KEYS } from "@/constants/sourceChannels";
import type { Db } from "@/db/client";
import type { LocalePreferenceFallback } from "@/features/i18n/localePreferenceCookies";
import type { PermSetUser } from "@/features/permissions/effective";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { DashboardFilters, OwnerScope } from "@/types/stats";
import { dealMetricPopulation, visibleDealPopulation } from "./dealPopulation";
import { hydrateReportActor } from "./hydrateReportActor";
import { resolveReportScope } from "./resolveReportScope";
import { dashboardInput } from "./schemas";

export const MAX_RECORDED_SOURCE_REPORT_DEALS = 200_000;
const recordedChannels = sql.join(
  SOURCE_CHANNEL_KEYS.map((key) => sql`${key}`),
  sql`, `,
);
const count = z.number().int().min(0).max(MAX_RECORDED_SOURCE_REPORT_DEALS);
const resultSchema = z.strictObject({
  limited: z.boolean(),
  rows: z
    .array(
      z.strictObject({
        channel: z.enum([...SOURCE_CHANNEL_KEYS, "unrecorded", "unrecognized"]),
        added: count,
        won: count,
        lost: count,
        wonValueCount: count,
        wonValue: z
          .string()
          .regex(/^-?\d{1,20}(?:\.\d{1,4})?$/)
          .nullable(),
        wonCycleCount: count,
        wonCycleMicroseconds: z
          .string()
          .regex(/^\d{1,30}$/)
          .nullable(),
      }),
    )
    .max(SOURCE_CHANNEL_KEYS.length + 2),
});

type RecordSourceInput = z.input<typeof dashboardInput>;
type ValidRecordSourceInput = z.output<typeof dashboardInput>;

export type RecordedDealSourceReport =
  | { state: "unavailable" }
  | { state: "permission" }
  | {
      state: "available";
      definition: "recorded-deal-source-current-v1";
      currency: string;
      timeZone: string;
      effectiveOwnerScope: OwnerScope["kind"];
      rows: z.output<typeof resultSchema>["rows"];
    };

async function readRows(
  tx: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  signal: AbortSignal,
) {
  const visible = await visibleDealPopulation(tx, actor, filters, signal);
  const added = dealMetricPopulation("added", filters);
  const won = dealMetricPopulation("won", filters);
  const lost = dealMetricPopulation("lost", filters);
  const result = await tx.execute(sql`
    WITH eligible AS MATERIALIZED (
      SELECT CASE
        WHEN d.source_channel IN (${recordedChannels}) THEN d.source_channel
        WHEN d.source_channel IS NULL OR pg_catalog.btrim(d.source_channel) = '' THEN 'unrecorded'
        ELSE 'unrecognized' END AS channel,
        (${added}) AS added, (${won}) AS won, (${lost}) AS lost,
        d.value, d.created_at, d.won_time
      FROM public.deals d JOIN public.pipelines p ON p.id = d.pipeline_id
      WHERE (${visible}) AND ((${added}) OR (${won}) OR (${lost}))
      LIMIT ${MAX_RECORDED_SOURCE_REPORT_DEALS + 1}
    ), capacity AS MATERIALIZED (
      SELECT count(*) > ${MAX_RECORDED_SOURCE_REPORT_DEALS} AS limited FROM eligible
    ), grouped AS (
      SELECT channel,
        count(*) FILTER (WHERE added)::int AS added,
        count(*) FILTER (WHERE won)::int AS won,
        count(*) FILTER (WHERE lost)::int AS lost,
        count(value) FILTER (WHERE won)::int AS "wonValueCount",
        sum(value) FILTER (WHERE won)::text AS "wonValue",
        count(*) FILTER (WHERE won AND won_time >= created_at)::int AS "wonCycleCount",
        (sum(EXTRACT(EPOCH FROM (won_time - created_at)) * 1000000)
          FILTER (WHERE won AND won_time >= created_at))::numeric(30,0)::text
          AS "wonCycleMicroseconds"
      FROM eligible WHERE NOT (SELECT limited FROM capacity)
      GROUP BY channel
    )
    SELECT limited, (SELECT coalesce(json_agg(g ORDER BY g.channel COLLATE pg_catalog."C"),
      '[]'::json) FROM grouped g) AS rows FROM capacity
  `);
  signal.throwIfAborted();
  const parsed = resultSchema.safeParse(result.rows[0]);
  if (!parsed.success || parsed.data.limited) return null;
  return parsed.data.rows.map((row) => ({
    ...row,
    wonValue: row.wonValue === null ? null : canonicalMoney(row.wonValue),
  }));
}

async function readInSnapshot(
  tx: Db,
  requestActor: PermSetUser,
  request: ValidRecordSourceInput,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<RecordedDealSourceReport> {
  await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
  await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
  const actor = await hydrateReportActor(tx, requestActor, signal);
  if (actor === null) return { state: "permission" };
  const { currency, effectiveOwnerScope, filters } = await resolveReportScope(
    tx,
    actor,
    request,
    signal,
    localeFallback,
  );
  const rows = await readRows(tx, actor, filters, signal);
  if (rows === null) return { state: "unavailable" };
  return {
    state: "available",
    definition: "recorded-deal-source-current-v1",
    currency,
    timeZone: filters.timeZone ?? "UTC",
    effectiveOwnerScope: effectiveOwnerScope.kind,
    rows,
  };
}

/**
 * Current recorded deal channel; a deal may be added and closed in the same reporting period.
 * Neither current channel nor editable deal clocks attest original acquisition or campaign credit.
 * Return only fixed channel classes and aggregate facts. The caller supplies an authenticated actor.
 */
export async function readRecordedDealSourceReport(
  db: Db,
  actor: PermSetUser,
  input: RecordSourceInput,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<RecordedDealSourceReport> {
  signal.throwIfAborted();
  const parsed = dashboardInput.safeParse(input);
  if (!parsed.success || !("$client" in db) || !(db.$client instanceof Pool))
    return { state: "unavailable" };
  try {
    const report = await db.transaction(
      (tx) => readInSnapshot(tx, actor, parsed.data, signal, localeFallback),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    signal.throwIfAborted();
    return report;
  } catch {
    signal.throwIfAborted();
    return { state: "unavailable" };
  }
}
