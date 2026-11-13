import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { newsletterOperationalState } from "@/db/schema";
import { OPERATIONAL_ENGINE_KEY } from "@/features/newsletter/delivery/operationalContracts";
import type { OperationsObservation } from "./contracts";

const evidenceWindowMs = 3 * 60_000;
type Evidence = { fingerprint: string; checkedAt: Date; lastPolledAt: Date | null; now: Date };

/** Project event consumption and sender readiness from the existing single engine monitor row. */
export function newsletterObservations(row: Evidence | undefined): OperationsObservation[] {
  const feature = { kind: "feature", feature: "newsletter_event_sync" } as const;
  const provider = { kind: "provider", provider: "newsletter_delivery" } as const;
  const unknown = { state: "unknown", reason: "not_reported" } as const;
  if (row === undefined)
    return [
      { ...feature, ...unknown },
      { ...provider, ...unknown },
    ];
  const now = row.now.getTime();
  const recent = (time: number | undefined): time is number =>
    time !== undefined &&
    Number.isFinite(time) &&
    Number.isFinite(now) &&
    time >= now - evidenceWindowMs &&
    time <= now;
  const poll = row.lastPolledAt?.getTime();
  const checked = row.checkedAt.getTime();
  if (
    recent(checked) &&
    row.fingerprint === "events_unavailable" &&
    (poll === undefined || checked > poll)
  ) {
    return [
      { ...feature, state: "failed", reason: "check_failed", sampledAtMs: checked },
      { ...provider, ...unknown },
    ];
  }
  const featureResult: OperationsObservation = recent(poll)
    ? { ...feature, state: "healthy", reason: "ok", sampledAtMs: poll }
    : { ...feature, ...unknown };
  // A poll-only insert seeds "ready" using the transaction start as checkedAt.
  // Only a subsequent explicit check can support a healthy or paused sender fact.
  if (!recent(poll) || !recent(checked) || checked <= poll)
    return [featureResult, { ...provider, ...unknown }];
  if (row.fingerprint === "ready")
    return [featureResult, { ...provider, state: "healthy", reason: "ok", sampledAtMs: checked }];
  if (row.fingerprint === "paused")
    return [
      featureResult,
      { ...provider, state: "unchecked", reason: "not_checked", sampledAtMs: checked },
    ];
  const [database, scheduler, relay] = row.fingerprint.split("/");
  if (database === "ready" && scheduler === "ready" && relay === "unconfigured")
    return [
      featureResult,
      { ...provider, state: "unchecked", reason: "not_configured", sampledAtMs: checked },
    ];
  if (database === "ready" && scheduler === "ready" && relay === "unavailable")
    return [
      featureResult,
      { ...provider, state: "failed", reason: "unavailable", sampledAtMs: checked },
    ];
  return [featureResult, { ...provider, ...unknown }];
}

export async function sampleNewsletterOperations(
  db: Db,
  signal: AbortSignal,
): Promise<OperationsObservation[]> {
  signal.throwIfAborted();
  const [row] = await db
    .select({
      fingerprint: newsletterOperationalState.fingerprint,
      checkedAt: newsletterOperationalState.checkedAt,
      lastPolledAt: newsletterOperationalState.lastPolledAt,
      now: sql<Date>`clock_timestamp()`.mapWith(newsletterOperationalState.checkedAt),
    })
    .from(newsletterOperationalState)
    .where(eq(newsletterOperationalState.engineKey, OPERATIONAL_ENGINE_KEY))
    .limit(1);
  signal.throwIfAborted();
  return newsletterObservations(row);
}
