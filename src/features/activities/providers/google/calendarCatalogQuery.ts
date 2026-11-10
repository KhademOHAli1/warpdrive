import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  calendarProviderBindings,
  calendarProviderCalendars,
  calendarProviderCatalogStates,
} from "@/db/schema/calendarProviderCatalog";
import { err, ok, type Result } from "@/types/result";
import { activeCalendarOwner, ownedCalendarAccount } from "./accountAccess";
import type {
  CalendarCatalogError,
  GoogleCalendarCatalog,
  GoogleCalendarCatalogEntry,
} from "./catalogContracts";
import { rethrowGoogleAbort } from "./errors";

type StoredCalendar = typeof calendarProviderCalendars.$inferSelect;
type StoredState = typeof calendarProviderCatalogStates.$inferSelect;
const readableRoles = new Set(["reader", "writerWithoutPrivateAccess", "writer", "owner"]);

function catalogEntry(row: StoredCalendar, state: StoredState): GoogleCalendarCatalogEntry {
  const raw = row.raw;
  const accessRole = raw.accessRole ?? null;
  const deleted = raw.deleted === true;
  const available =
    row.lastSeenRevision === state.revision &&
    !deleted &&
    accessRole !== null &&
    readableRoles.has(accessRole);
  return {
    id: row.id,
    calendarId: row.calendarId,
    name:
      typeof raw.summaryOverride === "string"
        ? raw.summaryOverride
        : (raw.summary ?? row.calendarId),
    timeZone: raw.timeZone ?? null,
    accessRole,
    hidden: raw.hidden === true,
    deleted,
    available,
    supportsMeet:
      available &&
      raw.conferenceProperties?.allowedConferenceSolutionTypes?.includes("hangoutsMeet") === true,
  };
}

export async function listGoogleCalendarCatalog(
  db: Db,
  userId: string,
  accountId: string,
  signal: AbortSignal,
): Promise<Result<GoogleCalendarCatalog, CalendarCatalogError>> {
  try {
    return await db.transaction(async (tx) => {
      const owner = await activeCalendarOwner(tx, userId, signal, true);
      if (!owner.ok) return owner;
      const account = await ownedCalendarAccount(tx, userId, accountId, signal);
      if (!account.ok) return account;
      const [state] = await tx
        .select()
        .from(calendarProviderCatalogStates)
        .where(eq(calendarProviderCatalogStates.accountId, accountId));
      signal.throwIfAborted();
      const empty: GoogleCalendarCatalog = {
        accountId,
        revision: state?.revision ?? 0,
        status: "unavailable",
        calendars: [],
        discoveredAt: null,
      };
      if (account.value.status !== "connected") return ok(empty);
      if (state === undefined) return ok({ ...empty, status: "empty" });
      if (state.requestedGeneration !== account.value.connectionGeneration) return ok(empty);
      const currentPublication = state.publishedGeneration === account.value.connectionGeneration;
      const result: GoogleCalendarCatalog = {
        ...empty,
        status:
          state.status === "refreshing" && state.requestExpiresAt.getTime() <= Date.now()
            ? "error"
            : state.status,
        discoveredAt: currentPublication ? (state.discoveredAt?.toISOString() ?? null) : null,
      };
      if (!currentPublication) return ok(result);
      const rows = await tx
        .select({ calendar: calendarProviderCalendars, binding: calendarProviderBindings })
        .from(calendarProviderCalendars)
        .leftJoin(
          calendarProviderBindings,
          and(
            eq(calendarProviderBindings.providerCalendarId, calendarProviderCalendars.id),
            eq(calendarProviderBindings.userId, userId),
          ),
        )
        .where(
          and(
            eq(calendarProviderCalendars.accountId, accountId),
            eq(calendarProviderCalendars.userId, userId),
            eq(calendarProviderCalendars.connectionGeneration, account.value.connectionGeneration),
          ),
        )
        .orderBy(calendarProviderCalendars.calendarId);
      signal.throwIfAborted();
      result.calendars = rows.map(({ calendar, binding }) => ({
        ...catalogEntry(calendar, state),
        ...(binding === null
          ? {}
          : {
              selection: {
                bindingId: binding.id,
                localCalendarId: binding.localCalendarId,
                version: binding.version,
                selected: binding.selected,
              },
            }),
      }));
      return ok(result);
    });
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return err({ kind: "storage" });
  }
}
