import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { currentNativeReadActor } from "@/features/auth/currentNativeActor";
import type { LocalePreferenceFallback } from "@/features/i18n/localePreferenceCookies";
import type { OwnerScope } from "@/types/stats";
import { calculateDashboardReport } from "./dashboardReport";
import { restrictReportActor } from "./hydrateReportActor";
import { resolveReportScope } from "./resolveReportScope";
import {
  loadSavedPerformanceReportInSnapshot,
  type SavedPerformanceReportPrincipal,
} from "./savedPerformanceReports";

const MAX_RESOLVED_OWNERS = 5_000;
export const savedPerformanceRerunInput = z.strictObject({
  id: z.uuid().transform((id) => id.toLowerCase()),
});

type LoadResult = Awaited<ReturnType<typeof loadSavedPerformanceReportInSnapshot>>;
type Loaded = Extract<LoadResult, { state: "loaded" }>;

export type SavedPerformanceRerun =
  | {
      state: "available";
      report: Loaded["report"];
      definition: Loaded["definition"];
      dashboard: Awaited<ReturnType<typeof calculateDashboardReport>>;
    }
  | Exclude<LoadResult, Loaded>;

function unavailable(
  reason: Extract<SavedPerformanceRerun, { state: "unavailable" }>["reason"],
): SavedPerformanceRerun {
  return { state: "unavailable", reason };
}

function exactOwnerScope(requested: OwnerScope, resolved: OwnerScope, actorId: string): boolean {
  // The normal dashboard normalizes the explicit self user selector to me.
  if (requested.kind === "user" && requested.userId === actorId && resolved.kind === "me")
    return true;
  if (requested.kind === "user")
    return resolved.kind === "user" && requested.userId === resolved.userId;
  if (requested.kind === "team")
    return resolved.kind === "team" && requested.teamId === resolved.teamId;
  return requested.kind === resolved.kind;
}

function matchesDefinition(
  resolved: Awaited<ReturnType<typeof resolveReportScope>>,
  definition: Loaded["definition"],
  actorId: string,
): boolean {
  const { filters, currency, effectiveOwnerScope } = resolved;
  return (
    currency === definition.currency &&
    filters.currency === definition.currency &&
    filters.pipelineId === definition.pipelineId &&
    filters.from === definition.from &&
    filters.to === definition.to &&
    exactOwnerScope(definition.ownerScope, effectiveOwnerScope, actorId)
  );
}

async function readInSnapshot(
  tx: Db,
  principal: SavedPerformanceReportPrincipal,
  id: string,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<SavedPerformanceRerun> {
  await tx.execute(sql`SET LOCAL search_path = pg_catalog, public, pg_temp`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
  await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
  const current = await currentNativeReadActor(tx, principal.session, signal);
  const actor = restrictReportActor(principal.actor, current?.actor ?? null);
  if (actor === null) return unavailable("authentication-required");

  const saved = await loadSavedPerformanceReportInSnapshot(tx, principal.actor, actor, id, signal);
  if (saved.state === "unavailable") return saved;
  const resolved = await resolveReportScope(
    tx,
    actor,
    saved.definition,
    signal,
    localeFallback,
    MAX_RESOLVED_OWNERS + 1,
  );
  if (!matchesDefinition(resolved, saved.definition, actor.id))
    return unavailable("scope-unavailable");
  if (!resolved.filters.owners.everyone && resolved.filters.owners.ids.length > MAX_RESOLVED_OWNERS)
    return unavailable("source-unavailable");

  const dashboard = await calculateDashboardReport(
    tx,
    actor,
    { ...resolved, effectiveOwnerScope: saved.definition.ownerScope },
    signal,
    "snapshot",
  );
  // Reapply the native wall-clock expiry/assurance policy before returning a long read.
  // The row authority and definition remain the same coherent database observation.
  if ((await currentNativeReadActor(tx, principal.session, signal)) === null)
    return unavailable("authentication-required");
  return { state: "available", report: saved.report, definition: saved.definition, dashboard };
}

async function runOnFreshClient(
  pool: Pool,
  principal: SavedPerformanceReportPrincipal,
  id: string,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<SavedPerformanceRerun> {
  const client = await pool.connect();
  let reusable = false;
  try {
    signal.throwIfAborted();
    if (client.getTransactionStatus() !== "I") return unavailable("source-unavailable");
    const bound = drizzle(client, { schema });
    const result = await bound.transaction(
      (tx) => readInSnapshot(tx, principal, id, signal, localeFallback),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    reusable = client.getTransactionStatus() === "I";
    signal.throwIfAborted();
    return reusable ? result : unavailable("source-unavailable");
  } finally {
    client.release(!reusable);
  }
}

/** The server supplies its authenticated session and actor. Only the saved ID comes from input. */
export async function rerunSavedPerformanceReport(
  db: Db,
  principal: SavedPerformanceReportPrincipal,
  input: z.input<typeof savedPerformanceRerunInput>,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<SavedPerformanceRerun> {
  signal.throwIfAborted();
  const parsed = savedPerformanceRerunInput.safeParse(input);
  if (!parsed.success) return unavailable("invalid-input");
  if (!principal.actor.isActive || principal.actor.id !== principal.session.userId)
    return unavailable("authentication-required");
  if (!("$client" in db) || !(db.$client instanceof Pool)) return unavailable("source-unavailable");
  try {
    return await runOnFreshClient(db.$client, principal, parsed.data.id, signal, localeFallback);
  } catch (error) {
    signal.throwIfAborted();
    return error instanceof AppError && error.id === ERROR_IDS.STATS_PIPELINE_NOT_VISIBLE
      ? unavailable("scope-unavailable")
      : unavailable("source-unavailable");
  }
}
