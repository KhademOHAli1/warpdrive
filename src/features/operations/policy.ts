import { ERROR_IDS } from "@/constants/errorIds";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import {
  type BoundOperationsBatch,
  OPERATIONS_MAX_CLOCK_SKEW_MS,
  OPERATIONS_MAX_TIMESTAMP_MS,
  type OperationsObservation,
  type OperationsState,
} from "./contracts";

/** Requires a current actor resolved inside the request's cooperating authority fence.
 * This pure predicate does not rehydrate a session or authenticate a supplied actor.
 */
export function requireOperationsAdmin(
  actor: PermSetUser | null,
): Result<PermSetUser, { id: string }> {
  if (actor === null || actor.isActive !== true) return err({ id: ERROR_IDS.AUTH_SESSION_DEAD });
  if (actor.type !== "admin") return err({ id: ERROR_IDS.PERM_DENIED });
  return ok(actor);
}

export interface OperationsObservationTiming {
  observedAtMs: number;
  receivedAtMs: number;
}
export interface OperationsFreshness {
  status: "current" | "stale" | "unchecked" | "unknown";
  reason: "current" | "expired" | "not_observed" | "clock_invalid" | "clock_ahead";
  ageMs: number | null;
  staleAtMs: number | null;
}
const validTimestamp = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= OPERATIONS_MAX_TIMESTAMP_MS;

/** The caller owns a finite sampling policy. Observation time and server receipt time
 * must both remain fresh, so delayed delivery cannot renew an old success.
 */
export function operationsFreshness(
  timing: OperationsObservationTiming | undefined,
  nowMs: number,
  staleAfterMs: number,
): OperationsFreshness {
  if (!timing) return { status: "unchecked", reason: "not_observed", ageMs: null, staleAtMs: null };
  if (
    !validTimestamp(nowMs) ||
    !validTimestamp(timing.observedAtMs) ||
    !validTimestamp(timing.receivedAtMs) ||
    !Number.isSafeInteger(staleAfterMs) ||
    staleAfterMs <= 0 ||
    staleAfterMs > 30 * 24 * 60 * 60 * 1000
  )
    return { status: "unknown", reason: "clock_invalid", ageMs: null, staleAtMs: null };
  if (
    timing.observedAtMs > nowMs ||
    timing.receivedAtMs > nowMs ||
    timing.observedAtMs > timing.receivedAtMs + OPERATIONS_MAX_CLOCK_SKEW_MS
  )
    return { status: "unknown", reason: "clock_ahead", ageMs: null, staleAtMs: null };
  const ageMs = nowMs - timing.observedAtMs;
  const staleAtMs = Math.min(timing.observedAtMs, timing.receivedAtMs) + staleAfterMs;
  if (!validTimestamp(staleAtMs))
    return { status: "unknown", reason: "clock_invalid", ageMs: null, staleAtMs: null };
  return nowMs >= staleAtMs
    ? { status: "stale", reason: "expired", ageMs, staleAtMs }
    : { status: "current", reason: "current", ageMs, staleAtMs };
}

/** An old successful observation can be displayed as history, never current health. */
export function operationsDisplayState(
  state: OperationsState,
  freshness: OperationsFreshness,
): OperationsState | "stale" {
  if (freshness.status === "stale") return "stale";
  if (freshness.status === "unchecked") return "unchecked";
  if (freshness.status === "unknown") return "unknown";
  return state;
}

/** Polling cached queue gauges or an old recovery receipt cannot renew those facts.
 * Heartbeat freshness never stands in for queue progress or recovery evidence.
 */
export function operationsObservationFreshness(
  observation: OperationsObservation,
  batch: BoundOperationsBatch,
  nowMs: number,
  staleAfterMs: number,
): OperationsFreshness {
  let observedAtMs: number | null = batch.batch.observedAtMs;
  if (observation.kind === "queue") observedAtMs = observation.sampledAtMs;
  if (observation.kind === "recovery" && observation.state === "healthy")
    observedAtMs = observation.completedAtMs;
  return operationsFreshness(
    observedAtMs === null ? undefined : { observedAtMs, receivedAtMs: batch.receivedAtMs },
    nowMs,
    staleAfterMs,
  );
}
