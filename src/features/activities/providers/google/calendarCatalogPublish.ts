import { and, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  calendarProviderCalendars,
  calendarProviderCatalogStates,
} from "@/db/schema/calendarProviderCatalog";
import { err, ok, type Result } from "@/types/result";
import { activeCalendarOwner, ownedCalendarAccount } from "./accountAccess";
import type { CalendarCatalogRun } from "./calendarCatalogState";
import type { CalendarCatalogError } from "./catalogContracts";
import { calendarEntryFitsStorage } from "./catalogStorage";
import type { GoogleCalendarEntry } from "./schemas";

const CATALOG_WRITE_BATCH = 200;

export async function publishGoogleCalendarCatalog(
  db: Db,
  run: CalendarCatalogRun,
  snapshot: { calendars: GoogleCalendarEntry[]; syncToken: string },
  signal: AbortSignal,
  now: () => Date,
): Promise<Result<void, CalendarCatalogError>> {
  signal.throwIfAborted();
  if (!snapshot.calendars.every(calendarEntryFitsStorage)) return err({ kind: "invalid_response" });
  return db
    .transaction(async (tx): Promise<Result<void, CalendarCatalogError>> => {
      const owner = await activeCalendarOwner(tx, run.userId, signal, true);
      if (!owner.ok) return owner;
      const account = await ownedCalendarAccount(tx, run.userId, run.accountId, signal);
      if (!account.ok) return account;
      if (
        account.value.status !== "connected" ||
        account.value.connectionGeneration !== run.connectionGeneration
      )
        return err({ kind: "conflict" });
      const [state] = await tx
        .select()
        .from(calendarProviderCatalogStates)
        .where(eq(calendarProviderCatalogStates.accountId, run.accountId))
        .for("update");
      signal.throwIfAborted();
      if (
        state === undefined ||
        state.latestRunId !== run.runId ||
        state.requestedGeneration !== run.connectionGeneration ||
        state.status !== "refreshing" ||
        state.requestExpiresAt.getTime() <= now().getTime()
      )
        return err({ kind: "conflict" });
      const revision = state.revision + 1;
      for (let start = 0; start < snapshot.calendars.length; start += CATALOG_WRITE_BATCH) {
        const batch = snapshot.calendars.slice(start, start + CATALOG_WRITE_BATCH);
        const stored = await tx
          .insert(calendarProviderCalendars)
          .values(
            batch.map((entry) => ({
              accountId: run.accountId,
              userId: run.userId,
              calendarId: entry.id,
              raw: entry,
              connectionGeneration: run.connectionGeneration,
              lastSeenRevision: revision,
            })),
          )
          .onConflictDoUpdate({
            target: [calendarProviderCalendars.accountId, calendarProviderCalendars.calendarIdHash],
            set: {
              raw: sql`excluded."raw"`,
              connectionGeneration: run.connectionGeneration,
              lastSeenRevision: revision,
            },
            setWhere: sql`${calendarProviderCalendars.calendarId} COLLATE "C" = excluded."calendar_id" COLLATE "C"`,
          })
          .returning({ id: calendarProviderCalendars.id });
        signal.throwIfAborted();
        if (stored.length !== batch.length)
          throw new AppError(
            ERROR_IDS.CALENDAR_CATALOG_IDENTITY_CONFLICT,
            "catalog identity conflict rejected a batch row",
          );
      }
      const publishedAt = now();
      if (state.requestExpiresAt.getTime() <= publishedAt.getTime())
        throw new AppError(
          ERROR_IDS.CALENDAR_CATALOG_RUN_EXPIRED,
          "catalog request expired during publication",
        );
      await tx
        .update(calendarProviderCatalogStates)
        .set({
          revision,
          publishedRunId: run.runId,
          publishedGeneration: run.connectionGeneration,
          syncToken: snapshot.syncToken,
          discoveredAt: publishedAt,
          status: "ready",
          lastErrorCode: null,
        })
        .where(
          and(
            eq(calendarProviderCatalogStates.accountId, run.accountId),
            eq(calendarProviderCatalogStates.latestRunId, run.runId),
          ),
        );
      signal.throwIfAborted();
      return ok(undefined);
    })
    .catch((error: unknown) => {
      if (error instanceof AppError && error.id === ERROR_IDS.CALENDAR_CATALOG_RUN_EXPIRED)
        return err({ kind: "conflict" as const });
      throw error;
    });
}
