import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { resolveAccountLocalePreferences } from "@/features/i18n/accountPreferences";
import { getPreferences } from "@/features/identity/preferencesRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import type { DashboardFilters, OwnerScope } from "@/types/stats";
import { resolveOwnerIds } from "./ownerIds";
import { ownerScope } from "./ownerScope";
import { isPipelineVisible } from "./visiblePipelines";

export async function resolveReportScope(
  db: Db,
  actor: PermSetUser,
  input: {
    currency?: string;
    pipelineId: string | null;
    ownerScope: OwnerScope;
    from: string;
    to: string;
  },
  signal: AbortSignal,
) {
  const effectiveOwnerScope = ownerScope(actor, input.ownerScope);
  const owners = await resolveOwnerIds(db, actor, effectiveOwnerScope, signal);
  if (
    input.pipelineId !== null &&
    !(await isPipelineVisible(db, actor, input.pipelineId, signal))
  ) {
    throw new AppError(
      ERROR_IDS.STATS_PIPELINE_NOT_VISIBLE,
      "requested pipeline not visible to user (restricted or archived)",
      { pipelineId: input.pipelineId },
    );
  }
  const [currency, preferences] = await Promise.all([
    input.currency ?? readBaseCurrency(db, signal),
    getPreferences(db, actor.id, signal),
  ]);
  signal.throwIfAborted();
  const { timeZone } = resolveAccountLocalePreferences({
    saved: preferences.ui.localePreferences,
    profileTimeZone: preferences.timezone,
  });
  const filters: DashboardFilters = {
    currency,
    pipelineId: input.pipelineId,
    owners,
    from: input.from,
    to: input.to,
    timeZone,
  };
  return { currency, effectiveOwnerScope, filters };
}
