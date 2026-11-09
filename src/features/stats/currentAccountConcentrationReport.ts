import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { currentNativeReadActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { toRefActor } from "@/features/contacts/actorAdapters";
import { contactVisibilityClause } from "@/features/contacts/visibilitySql";
import type { LocalePreferenceFallback } from "@/features/i18n/localePreferenceCookies";
import type { PermSetUser } from "@/features/permissions/effective";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { DashboardFilters, OwnerScope } from "@/types/stats";
import { dealMetricPopulation, visibleDealPopulation } from "./dealPopulation";
import { restrictReportActor } from "./hydrateReportActor";
import { resolveReportScope } from "./resolveReportScope";
import { dashboardInput } from "./schemas";

export const MAX_CURRENT_ACCOUNT_REPORT_DEALS = 50_000;
const MAX_RESOLVED_OWNERS = 5_000;
const count = z.number().int().min(0).max(MAX_CURRENT_ACCOUNT_REPORT_DEALS);
const amount = z
  .string()
  .regex(/^-?\d{1,20}(?:\.\d{1,4})?$/)
  .nullable();
const coverageSchema = z.strictObject({
  eligibleWonDeals: count,
  linkedWonDeals: count,
  unresolvedWonDeals: count,
  linkedOrganizations: count,
  multiWonLinkedOrganizations: count,
  linkedWonDealsWithValue: count,
  linkedWonDealsWithoutValue: count,
});
const rowSchema = z.strictObject({
  limited: z.boolean(),
  ...coverageSchema.shape,
  linkedKnownNominalNet: amount,
  positiveNetOrganizations: count,
  zeroNetOrganizations: count,
  negativeNetOrganizations: count,
  positiveNetDenominator: amount,
  largestNetNumerator: amount,
  topFiveNetNumerator: amount,
});

export const currentAccountConcentrationInput = dashboardInput.strict();
type Request = z.output<typeof currentAccountConcentrationInput>;
type Coverage = z.output<typeof coverageSchema>;
type Row = z.output<typeof rowSchema>;

export interface CurrentAccountReportPrincipal {
  readonly actor: PermSetUser;
  readonly session: NativeSessionRef;
}

interface NetCoverage {
  positiveNetOrganizations: number;
  zeroNetOrganizations: number;
  negativeNetOrganizations: number;
}

type Concentration =
  | { state: "empty" }
  | { state: "withheld"; reason: "unresolved-organization" | "missing-nominal-value" }
  | ({ state: "no-positive-net" } & NetCoverage)
  | ({
      state: "available";
      positiveNetDenominator: string;
      largestNetNumerator: string;
      topFiveNetNumerator: string;
    } & NetCoverage);

export type CurrentAccountConcentrationReport =
  | { state: "permission" | "scope-unavailable" | "unavailable" }
  | {
      state: "available";
      definition: "current-linked-organization-won-nominal-v1";
      currency: string;
      timeZone: string;
      from: string;
      to: string;
      effectiveOwnerScope: OwnerScope["kind"];
      coverage: Coverage;
      linkedKnownNominalNet: string | null;
      concentration: Concentration;
    };

function organizationVisibility(actor: PermSetUser) {
  return contactVisibilityClause(toRefActor(actor), {
    ownerId: sql`o.owner_id`,
    visibilityLevel: sql`o.visibility_level`,
    visibilityGroupId: sql`o.visibility_group_id`,
    visibleToUserIds: sql`o.visible_to_user_ids`,
  });
}

async function readAggregate(
  tx: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  signal: AbortSignal,
) {
  const dealVisibility = await visibleDealPopulation(tx, actor, filters, signal);
  const won = dealMetricPopulation("won", filters);
  const result = await tx.execute(sql`
    WITH selected AS MATERIALIZED (
      SELECT d.org_id, d.value
      FROM public.deals d JOIN public.pipelines p ON p.id = d.pipeline_id
      WHERE (${dealVisibility}) AND (${won})
      LIMIT ${MAX_CURRENT_ACCOUNT_REPORT_DEALS + 1}
    ), capacity AS MATERIALIZED (
      SELECT count(*) > ${MAX_CURRENT_ACCOUNT_REPORT_DEALS} AS limited FROM selected
    ), authorized AS MATERIALIZED (
      SELECT o.id AS organization_id, s.value
      FROM selected s LEFT JOIN public.organizations o
        ON o.id = s.org_id AND o.deleted_at IS NULL AND (${organizationVisibility(actor)})
      WHERE NOT (SELECT limited FROM capacity)
    ), deals_summary AS (
      SELECT count(*)::int AS "eligibleWonDeals",
        count(organization_id)::int AS "linkedWonDeals",
        count(*) FILTER (WHERE organization_id IS NULL)::int AS "unresolvedWonDeals",
        count(value) FILTER (WHERE organization_id IS NOT NULL)::int AS "linkedWonDealsWithValue",
        count(*) FILTER (WHERE organization_id IS NOT NULL AND value IS NULL)::int
          AS "linkedWonDealsWithoutValue",
        sum(value) FILTER (WHERE organization_id IS NOT NULL)::text AS "linkedKnownNominalNet"
      FROM authorized
    ), by_organization AS MATERIALIZED (
      SELECT organization_id, count(*) AS deals_count, sum(value) AS net
      FROM authorized
      WHERE organization_id IS NOT NULL
      GROUP BY organization_id
    ), organizations_summary AS (
      SELECT count(*)::int AS "linkedOrganizations",
        count(*) FILTER (WHERE deals_count > 1)::int AS "multiWonLinkedOrganizations",
        count(*) FILTER (WHERE net > 0)::int AS "positiveNetOrganizations",
        count(*) FILTER (WHERE net = 0)::int AS "zeroNetOrganizations",
        count(*) FILTER (WHERE net < 0)::int AS "negativeNetOrganizations",
        sum(net) FILTER (WHERE net > 0)::text AS "positiveNetDenominator",
        max(net) FILTER (WHERE net > 0)::text AS "largestNetNumerator"
      FROM by_organization
    ), largest AS (
      SELECT net
      FROM by_organization
      WHERE net > 0
      ORDER BY net DESC, organization_id
      LIMIT 5
    )
    SELECT capacity.limited, deals_summary.*, organizations_summary.*,
      (SELECT sum(net)::text FROM largest) AS "topFiveNetNumerator"
    FROM capacity CROSS JOIN deals_summary CROSS JOIN organizations_summary
  `);
  signal.throwIfAborted();
  const parsed = rowSchema.safeParse(result.rows[0]);
  return parsed.success && !parsed.data.limited ? parsed.data : null;
}

function coverageFor(row: Row): Coverage | null {
  if (
    row.linkedWonDeals + row.unresolvedWonDeals !== row.eligibleWonDeals ||
    row.linkedWonDealsWithValue + row.linkedWonDealsWithoutValue !== row.linkedWonDeals ||
    row.linkedOrganizations + row.multiWonLinkedOrganizations > row.linkedWonDeals ||
    row.multiWonLinkedOrganizations > row.linkedOrganizations ||
    (row.linkedOrganizations === 0) !== (row.linkedWonDeals === 0) ||
    (row.linkedKnownNominalNet === null) !== (row.linkedWonDealsWithValue === 0)
  )
    return null;
  return {
    eligibleWonDeals: row.eligibleWonDeals,
    linkedWonDeals: row.linkedWonDeals,
    unresolvedWonDeals: row.unresolvedWonDeals,
    linkedOrganizations: row.linkedOrganizations,
    multiWonLinkedOrganizations: row.multiWonLinkedOrganizations,
    linkedWonDealsWithValue: row.linkedWonDealsWithValue,
    linkedWonDealsWithoutValue: row.linkedWonDealsWithoutValue,
  };
}

function concentrationFor(row: Row): Concentration | null {
  if (row.eligibleWonDeals === 0) return { state: "empty" };
  if (row.unresolvedWonDeals > 0) return { state: "withheld", reason: "unresolved-organization" };
  if (row.linkedWonDealsWithoutValue > 0)
    return { state: "withheld", reason: "missing-nominal-value" };
  const { positiveNetOrganizations, zeroNetOrganizations, negativeNetOrganizations } = row;
  const coverage = { positiveNetOrganizations, zeroNetOrganizations, negativeNetOrganizations };
  if (
    positiveNetOrganizations + zeroNetOrganizations + negativeNetOrganizations !==
    row.linkedOrganizations
  )
    return null;
  if (positiveNetOrganizations === 0) return { state: "no-positive-net", ...coverage };

  const { positiveNetDenominator, largestNetNumerator, topFiveNetNumerator } = row;
  if (
    positiveNetDenominator === null ||
    largestNetNumerator === null ||
    topFiveNetNumerator === null
  )
    return null;
  return {
    state: "available",
    ...coverage,
    positiveNetDenominator: canonicalMoney(positiveNetDenominator),
    largestNetNumerator: canonicalMoney(largestNetNumerator),
    topFiveNetNumerator: canonicalMoney(topFiveNetNumerator),
  };
}

async function readInSnapshot(
  tx: Db,
  principal: CurrentAccountReportPrincipal,
  request: Request,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<CurrentAccountConcentrationReport> {
  await tx.execute(sql`SET LOCAL search_path = pg_catalog, public, pg_temp`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
  await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
  const current = await currentNativeReadActor(tx, principal.session, signal);
  const actor = restrictReportActor(principal.actor, current?.actor ?? null);
  if (actor === null) return { state: "permission" };
  const { currency, effectiveOwnerScope, filters } = await resolveReportScope(
    tx,
    actor,
    request,
    signal,
    localeFallback,
    MAX_RESOLVED_OWNERS + 1,
  );
  if (!filters.owners.everyone && filters.owners.ids.length > MAX_RESOLVED_OWNERS)
    return { state: "unavailable" };
  const row = await readAggregate(tx, actor, filters, signal);
  if (row === null) return { state: "unavailable" };
  const coverage = coverageFor(row);
  const concentration = concentrationFor(row);
  if (coverage === null || concentration === null) return { state: "unavailable" };
  if ((await currentNativeReadActor(tx, principal.session, signal)) === null)
    return { state: "permission" };
  return {
    state: "available",
    definition: "current-linked-organization-won-nominal-v1",
    currency,
    timeZone: filters.timeZone ?? "UTC",
    from: filters.from,
    to: filters.to,
    effectiveOwnerScope: effectiveOwnerScope.kind,
    coverage,
    linkedKnownNominalNet:
      row.linkedKnownNominalNet === null ? null : canonicalMoney(row.linkedKnownNominalNet),
    concentration,
  };
}

async function readOnFreshClient(
  pool: Pool,
  principal: CurrentAccountReportPrincipal,
  request: Request,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<CurrentAccountConcentrationReport> {
  const client = await pool.connect();
  let reusable = false;
  try {
    signal.throwIfAborted();
    if (client.getTransactionStatus() !== "I") return { state: "unavailable" };
    const report = await drizzle(client, { schema }).transaction(
      (tx) => readInSnapshot(tx, principal, request, signal, localeFallback),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    reusable = client.getTransactionStatus() === "I";
    signal.throwIfAborted();
    return reusable ? report : { state: "unavailable" };
  } finally {
    client.release(!reusable);
  }
}

/** The caller supplies the authenticated request principal. Only aggregate facts leave this reader. */
export async function readCurrentAccountConcentrationReport(
  db: Db,
  principal: CurrentAccountReportPrincipal,
  input: z.input<typeof currentAccountConcentrationInput>,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<CurrentAccountConcentrationReport> {
  signal.throwIfAborted();
  if (!principal.actor.isActive || principal.actor.id !== principal.session.userId)
    return { state: "permission" };
  const parsed = currentAccountConcentrationInput.safeParse(input);
  if (!parsed.success || !("$client" in db) || !(db.$client instanceof Pool))
    return { state: "unavailable" };
  try {
    return await readOnFreshClient(db.$client, principal, parsed.data, signal, localeFallback);
  } catch (error) {
    signal.throwIfAborted();
    return error instanceof AppError && error.id === ERROR_IDS.STATS_PIPELINE_NOT_VISIBLE
      ? { state: "scope-unavailable" }
      : { state: "unavailable" };
  }
}
