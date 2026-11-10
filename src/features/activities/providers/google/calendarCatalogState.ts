import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarProviderCatalogStates } from "@/db/schema/calendarProviderCatalog";
import { err, ok, type Result } from "@/types/result";
import { activeCalendarOwner, ownedCalendarAccount } from "./accountAccess";
import type { CalendarAccessGrant } from "./accountTokens";
import type { CalendarCatalogError } from "./catalogContracts";

const DISCOVERY_LIFETIME_MS = 60_000;

export interface CalendarCatalogRun {
  userId: string;
  accountId: string;
  connectionGeneration: number;
  runId: string;
}

export async function beginCalendarCatalogDiscovery(
  db: Db,
  userId: string,
  grant: CalendarAccessGrant,
  signal: AbortSignal,
  now: () => Date,
): Promise<Result<CalendarCatalogRun, CalendarCatalogError>> {
  return db.transaction(async (tx) => {
    const owner = await activeCalendarOwner(tx, userId, signal, true);
    if (!owner.ok) return owner;
    const account = await ownedCalendarAccount(tx, userId, grant.accountId, signal);
    if (!account.ok) return account;
    const requestedAt = now();
    if (
      account.value.status !== "connected" ||
      account.value.connectionGeneration !== grant.connectionGeneration ||
      grant.expiresAt <= requestedAt.getTime()
    )
      return err({ kind: "conflict" });
    const run: CalendarCatalogRun = {
      userId,
      accountId: grant.accountId,
      connectionGeneration: grant.connectionGeneration,
      runId: randomUUID(),
    };
    const requested = {
      latestRunId: run.runId,
      requestedGeneration: run.connectionGeneration,
      requestExpiresAt: new Date(requestedAt.getTime() + DISCOVERY_LIFETIME_MS),
      status: "refreshing" as const,
      lastErrorCode: null,
    };
    await tx
      .insert(calendarProviderCatalogStates)
      .values({ accountId: run.accountId, ...requested })
      .onConflictDoUpdate({ target: calendarProviderCatalogStates.accountId, set: requested });
    signal.throwIfAborted();
    return ok(run);
  });
}

export async function failCalendarCatalogDiscovery(
  db: Db,
  run: CalendarCatalogRun,
  code: CalendarCatalogError["kind"] | "aborted",
  signal: AbortSignal,
): Promise<void> {
  await db.transaction(async (tx) => {
    const owner = await activeCalendarOwner(tx, run.userId, signal, true);
    if (!owner.ok) return;
    const account = await ownedCalendarAccount(tx, run.userId, run.accountId, signal);
    if (
      !account.ok ||
      account.value.status !== "connected" ||
      account.value.connectionGeneration !== run.connectionGeneration
    )
      return;
    await tx
      .update(calendarProviderCatalogStates)
      .set({ status: "error", lastErrorCode: code })
      .where(
        and(
          eq(calendarProviderCatalogStates.accountId, run.accountId),
          eq(calendarProviderCatalogStates.latestRunId, run.runId),
          eq(calendarProviderCatalogStates.requestedGeneration, run.connectionGeneration),
          eq(calendarProviderCatalogStates.status, "refreshing"),
        ),
      );
    signal.throwIfAborted();
  });
}
