import type { operationsCurrent, operationsSources } from "@/db/schema";
import { type OperationsObservation, operationsObservationSchema } from "./contracts";
import { operationsDisplayState, operationsFreshness } from "./policy";

export type StoredOperationsCurrent = typeof operationsCurrent.$inferSelect;
export type StoredOperationsSource = typeof operationsSources.$inferSelect;

function currentSourceState(source: StoredOperationsSource, generationId: string) {
  if (!source.active) return "inactive";
  if (source.admissionState === "storage_pressure") return "storage_pressure";
  return source.currentGenerationId === generationId ? "active" : "retired_generation";
}

function currentReason(
  sourceState: ReturnType<typeof currentSourceState>,
  freshness: ReturnType<typeof operationsFreshness>,
  observedReason: OperationsObservation["reason"],
): string {
  if (sourceState === "storage_pressure") return "storage_pressure";
  if (sourceState !== "active") return "source_unavailable";
  if (freshness.status === "stale") return "observation_stale";
  if (freshness.status === "unchecked") return "not_observed";
  return freshness.status === "unknown" ? freshness.reason : observedReason;
}

// Initial server polling policy, not an installed availability or recovery SLA.
// UI callers cannot supply or extend these freshness windows.
export function operationsStaleAfter(observation: OperationsObservation): number {
  if (observation.kind === "queue") return 5 * 60_000;
  // Worker registry evidence is current for three configured 30-second beats.
  if (
    observation.kind === "heartbeat" &&
    observation.component === "worker" &&
    observation.sampledAtMs !== undefined
  )
    return 90_000;
  if (observation.kind === "deployment") return 30 * 24 * 60 * 60_000;
  if (observation.kind === "recovery") {
    const restoreCheck =
      observation.stage === "restore_tested" || observation.stage === "restore_bytes_verified";
    return (restoreCheck ? 30 : 1) * 24 * 60 * 60_000;
  }
  return 3 * 60_000;
}

export function operationsOrderingAt(
  observation: OperationsObservation,
  batchObservedAt: Date,
): Date {
  if (observation.kind === "queue" && observation.sampledAtMs !== null)
    return new Date(observation.sampledAtMs);
  if (
    (observation.kind === "feature" ||
      observation.kind === "provider" ||
      observation.kind === "heartbeat") &&
    observation.sampledAtMs !== undefined
  )
    return new Date(observation.sampledAtMs);
  if (
    observation.kind === "recovery" &&
    observation.state === "healthy" &&
    observation.completedAtMs !== null
  )
    return new Date(observation.completedAtMs);
  return batchObservedAt;
}

export function projectOperationsCurrent(
  row: StoredOperationsCurrent,
  source: StoredOperationsSource,
  now: Date,
) {
  const parsed = operationsObservationSchema.safeParse(row.observation);
  const sourceState = currentSourceState(source, row.generationId);
  if (!parsed.success)
    return {
      sourceId: row.sourceId,
      observationKey: row.observationKey,
      generationId: row.generationId,
      sequence: row.sequence,
      receiptId: row.receiptId,
      payloadSha256: row.payloadSha256,
      sourceState,
      observation: null,
      state: "unknown" as const,
      reason: "stored_observation_invalid",
      freshness: operationsFreshness(
        { observedAtMs: -1, receivedAtMs: row.receivedAt.getTime() },
        now.getTime(),
        1,
      ),
      observedAt: row.batchObservedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
    };
  const observation = parsed.data;
  const timing =
    observation.kind === "queue" && observation.sampledAtMs === null
      ? undefined
      : {
          observedAtMs: operationsOrderingAt(observation, row.batchObservedAt).getTime(),
          receivedAtMs: row.receivedAt.getTime(),
        };
  const freshness = operationsFreshness(timing, now.getTime(), operationsStaleAfter(observation));
  const state =
    sourceState === "active"
      ? operationsDisplayState(observation.state, freshness)
      : ("unknown" as const);
  const reason = currentReason(sourceState, freshness, observation.reason);
  return {
    sourceId: row.sourceId,
    observationKey: row.observationKey,
    generationId: row.generationId,
    sequence: row.sequence,
    receiptId: row.receiptId,
    payloadSha256: row.payloadSha256,
    sourceState,
    observation,
    state,
    reason,
    freshness,
    observedAt: row.batchObservedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
  };
}
