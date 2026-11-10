import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  calendarProviderCalendars,
  calendarProviderCatalogStates,
} from "@/db/schema/calendarProviderCatalog";
import { isTimeZone } from "@/features/i18n/preferences";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { ownedCalendarAccount } from "./accountAccess";
import type { CalendarCatalogError } from "./catalogContracts";
import { calendarEntrySchema } from "./schemas";

export const googleCalendarSelectionInput = z.strictObject({
  accountId: z.uuid(),
  calendarId: z.uuid(),
  selected: z.boolean(),
  expectedCatalogRevision: z.number().int().nonnegative(),
  expectedBindingVersion: z.number().int().positive().nullable(),
});
export type GoogleCalendarSelectionInput = z.infer<typeof googleCalendarSelectionInput>;
type ProviderCalendar = typeof calendarProviderCalendars.$inferSelect;
type CatalogState = typeof calendarProviderCatalogStates.$inferSelect;

export async function loadOwnedProviderCalendar(
  tx: DbOrTx,
  userId: string,
  input: GoogleCalendarSelectionInput,
  signal: AbortSignal,
): Promise<ProviderCalendar | undefined> {
  const [calendar] = await tx
    .select()
    .from(calendarProviderCalendars)
    .where(
      and(
        eq(calendarProviderCalendars.id, input.calendarId),
        eq(calendarProviderCalendars.accountId, input.accountId),
        eq(calendarProviderCalendars.userId, userId),
      ),
    );
  signal.throwIfAborted();
  return calendar;
}

function currentCatalog(
  state: CatalogState | undefined,
  calendar: ProviderCalendar,
  generation: number,
  revision: number,
): boolean {
  return (
    state !== undefined &&
    state.status === "ready" &&
    state.revision === revision &&
    state.requestedGeneration === generation &&
    state.publishedGeneration === generation &&
    state.publishedRunId === state.latestRunId &&
    state.syncToken !== null &&
    state.discoveredAt !== null &&
    calendar.connectionGeneration === generation &&
    calendar.lastSeenRevision === state.revision
  );
}

export async function admitCalendarSelectionAdd(
  tx: DbOrTx,
  userId: string,
  input: GoogleCalendarSelectionInput,
  calendar: ProviderCalendar,
  signal: AbortSignal,
): Promise<Result<{ name: string; timeZone: string }, CalendarCatalogError>> {
  const account = await ownedCalendarAccount(tx, userId, input.accountId, signal);
  if (!account.ok) return account;
  if (account.value.status !== "connected") return err({ kind: "disconnected" });
  const [state] = await tx
    .select()
    .from(calendarProviderCatalogStates)
    .where(eq(calendarProviderCatalogStates.accountId, input.accountId))
    .for("share");
  signal.throwIfAborted();
  if (
    !currentCatalog(
      state,
      calendar,
      account.value.connectionGeneration,
      input.expectedCatalogRevision,
    )
  )
    return err({ kind: "conflict" });
  const parsed = calendarEntrySchema.safeParse(calendar.raw);
  if (!parsed.success || parsed.data.id !== calendar.calendarId)
    return err({ kind: "invalid_response" });
  if (
    parsed.data.deleted === true ||
    !["reader", "writer", "owner", "writerWithoutPrivateAccess"].includes(
      parsed.data.accessRole ?? "none",
    )
  )
    return err({ kind: "calendar_read_only" });
  const timeZone = parsed.data.timeZone;
  if (timeZone === undefined || timeZone.length > 100 || !isTimeZone(timeZone))
    return err({ kind: "invalid_response" });
  return ok({
    name: parsed.data.summaryOverride ?? parsed.data.summary ?? parsed.data.id,
    timeZone,
  });
}
