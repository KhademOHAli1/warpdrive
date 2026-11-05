import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { dealVisibilityClause } from "@/features/deals/visibility";
import type { LocalePreferenceFallback } from "@/features/i18n/localePreferenceCookies";
import { leadVisibilityClause } from "@/features/leads/visibility";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DealVisibilitySession } from "@/types/session";
import type { DashboardFilters, OwnerScope } from "@/types/stats";
import { hydrateReportActor } from "./hydrateReportActor";
import { ownerFilterClause } from "./ownerIds";
import { reportPeriod } from "./reportPeriod";
import { resolveReportScope } from "./resolveReportScope";
import { dashboardInput } from "./schemas";

export const MAX_HANDOFF_LEADS = 50_000;
const count = z.number().int().min(0).max(MAX_HANDOFF_LEADS);
const countsSchema = z.strictObject({
  eligibleLeads: count,
  linkedLeads: count,
  distinctLinkedDeals: count,
  pendingUnlinkedLeads: count,
  archivedUnlinkedLeads: count,
  unavailableLinkedLeads: count,
});
const resultSchema = z.strictObject({ limited: z.boolean(), counts: countsSchema.nullable() });
const inputSchema = dashboardInput.strict();

export type CurrentLeadHandoffRequest = z.input<typeof inputSchema>;
type Request = z.output<typeof inputSchema>;
type Counts = z.output<typeof countsSchema>;

export type CurrentLeadHandoffReport =
  | { state: "permission" | "scope-unavailable" | "unavailable" }
  | {
      state: "available";
      definition: "current-lead-deal-link-v1";
      population: "current-visible-leads-created-in-period";
      destination: "current-visible-live-linked-deal";
      handoffHistory: "unqualified";
      firstResponseHistory: "unqualified";
      currency: string;
      timeZone: string;
      effectiveOwnerScope: OwnerScope["kind"];
      counts: Counts;
    };

function asVisibilitySession(actor: PermSetUser): DealVisibilitySession {
  return {
    userId: actor.id,
    isAdmin: actor.type === "admin",
    isActive: actor.isActive,
    sessionLive: true,
    visibilityGroupIds: [...actor.groupIds],
    managedUserIds: [...(actor.managedUserIds ?? [])],
  };
}

function reconciles(counts: Counts): boolean {
  const {
    linkedLeads,
    distinctLinkedDeals,
    pendingUnlinkedLeads,
    archivedUnlinkedLeads,
    unavailableLinkedLeads,
    eligibleLeads,
  } = counts;
  return (
    distinctLinkedDeals <= linkedLeads &&
    (distinctLinkedDeals === 0) === (linkedLeads === 0) &&
    linkedLeads + pendingUnlinkedLeads + archivedUnlinkedLeads + unavailableLinkedLeads ===
      eligibleLeads
  );
}

async function readCounts(
  tx: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  currency: string,
  signal: AbortSignal,
): Promise<Counts | null> {
  const session = asVisibilitySession(actor);
  const period = reportPeriod(filters);
  const result = await tx.execute(sql`
    WITH selected AS MATERIALIZED (
      SELECT leads.id, leads.converted_deal_id, leads.archived_at IS NOT NULL AS archived
      FROM public.leads
      WHERE leads.deleted_at IS NULL
        AND leads.currency = ${currency}
        AND leads.created_at >= ${period.from} AND leads.created_at < ${period.toExclusive}
        AND (${leadVisibilityClause(session)})
        ${ownerFilterClause(sql`leads.owner_id`, filters.owners)}
      LIMIT ${MAX_HANDOFF_LEADS + 1}
    ), capacity AS MATERIALIZED (
      SELECT count(*) > ${MAX_HANDOFF_LEADS} AS limited FROM selected
    ), linked AS MATERIALIZED (
      SELECT s.id AS lead_id, d.id AS deal_id
      FROM selected s
      JOIN public.deals d ON d.id = s.converted_deal_id
      JOIN public.pipelines p ON p.id = d.pipeline_id
      WHERE NOT (SELECT limited FROM capacity)
        AND d.deleted_at IS NULL AND d.archived_at IS NULL AND NOT p.is_archived
        AND (${dealVisibilityClause(session)})
    ), totals AS (
      SELECT count(*)::int AS "eligibleLeads",
        count(l.deal_id)::int AS "linkedLeads",
        count(DISTINCT l.deal_id)::int AS "distinctLinkedDeals",
        count(*) FILTER (WHERE s.converted_deal_id IS NULL AND NOT s.archived)::int
          AS "pendingUnlinkedLeads",
        count(*) FILTER (WHERE s.converted_deal_id IS NULL AND s.archived)::int
          AS "archivedUnlinkedLeads",
        count(*) FILTER (WHERE s.converted_deal_id IS NOT NULL AND l.deal_id IS NULL)::int
          AS "unavailableLinkedLeads"
      FROM selected s LEFT JOIN linked l ON l.lead_id = s.id
    )
    SELECT limited, CASE WHEN limited THEN NULL ELSE (SELECT row_to_json(t) FROM totals t) END AS counts
    FROM capacity
  `);
  signal.throwIfAborted();
  const parsed = resultSchema.safeParse(result.rows[0]);
  if (!parsed.success || parsed.data.limited || parsed.data.counts === null) return null;
  return reconciles(parsed.data.counts) ? parsed.data.counts : null;
}

async function readInSnapshot(
  tx: Db,
  requestActor: PermSetUser,
  request: Request,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<CurrentLeadHandoffReport> {
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
  const counts = await readCounts(tx, actor, filters, currency, signal);
  if (counts === null) return { state: "unavailable" };
  return {
    state: "available",
    definition: "current-lead-deal-link-v1",
    population: "current-visible-leads-created-in-period",
    destination: "current-visible-live-linked-deal",
    handoffHistory: "unqualified",
    firstResponseHistory: "unqualified",
    currency,
    timeZone: filters.timeZone ?? "UTC",
    effectiveOwnerScope: effectiveOwnerScope.kind,
    counts,
  };
}

/**
 * The caller supplies the authenticated actor. Lead scope and the destination's live
 * visibility are independent. The pointer describes current linkage only.
 */
export async function readCurrentLeadHandoffReport(
  db: Db,
  actor: PermSetUser,
  input: CurrentLeadHandoffRequest,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<CurrentLeadHandoffReport> {
  signal.throwIfAborted();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success || !("$client" in db) || !(db.$client instanceof Pool))
    return { state: "unavailable" };
  // Leads have no pipeline. A selected pipeline cannot define the pending denominator.
  if (parsed.data.pipelineId !== null) return { state: "scope-unavailable" };
  try {
    const result = await db.transaction(
      (tx) => readInSnapshot(tx, actor, parsed.data, signal, localeFallback),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    signal.throwIfAborted();
    return result;
  } catch {
    signal.throwIfAborted();
    return { state: "unavailable" };
  }
}
