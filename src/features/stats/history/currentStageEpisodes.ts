import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DashboardFilters } from "@/types/stats";
import type { HistoryActivation } from "./contracts";
import { foldTransactionHistory } from "./fold";
import { type CurrentDealHistory, readCurrentDealHistory } from "./repository";
import {
  deriveStageEpisodes,
  type StageEpisodesResult,
  type StageEpisodeUnavailableReason,
} from "./stageEpisodes";

export type CurrentStageEpisodeReport =
  | Exclude<CurrentDealHistory, { state: "available" | "partial" }>
  | { state: "unavailable"; reason: "history-limit" | "history-fold-invalid" }
  | {
      state: "unavailable";
      reason: "aging-evidence-unavailable";
      detail: StageEpisodeUnavailableReason;
    }
  | {
      state: "available";
      activation: HistoryActivation;
      observedAt: string;
      episodes: Extract<StageEpisodesResult, { ok: true }>;
    };

// This adapter is the completeness gate between the bounded reader and the pure aging
// kernel. Never interpret the end of a partial page as the current open stage.
// Inactive-state policy applies to transaction-final states. An in-transaction archive
// and restoration does not establish a separately visible inactive interval.
export function currentStageEpisodesFromHistory(
  history: CurrentDealHistory,
): CurrentStageEpisodeReport {
  if (history.state !== "available" && history.state !== "partial") return history;
  if (history.state === "partial" || !history.complete)
    return { state: "unavailable", reason: "history-limit" };
  const folded = foldTransactionHistory(history.events);
  if (!folded.ok) return { state: "unavailable", reason: "history-fold-invalid" };
  const episodes = deriveStageEpisodes(folded.changes, history.observation.observedAt);
  if (!episodes.ok)
    return { state: "unavailable", reason: "aging-evidence-unavailable", detail: episodes.reason };
  return {
    state: "available",
    activation: history.activation,
    observedAt: history.observation.observedAt,
    episodes,
  };
}

// Internal server service: actor/session hydration and report-scope resolution remain the
// authenticated caller's responsibility. The reader defensively reapplies the owner ceiling.
export async function readCurrentDealStageEpisodes(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  dealId: string,
  signal: AbortSignal,
): Promise<CurrentStageEpisodeReport> {
  const history = await readCurrentDealHistory(db, actor, filters, dealId, signal);
  signal.throwIfAborted();
  return currentStageEpisodesFromHistory(history);
}
