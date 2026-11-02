import { and, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { calendarProviderBindings } from "@/db/schema/calendarProviderCatalog";
import { calendars } from "@/db/schema/calendars";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { activeCalendarOwner } from "./accountAccess";
import {
  admitCalendarSelectionAdd,
  type GoogleCalendarSelectionInput,
  googleCalendarSelectionInput,
  loadOwnedProviderCalendar,
} from "./calendarBindingAccess";
import type { CalendarCatalogError, GoogleCalendarSelection } from "./catalogContracts";
import { rethrowGoogleAbort } from "./errors";

type Binding = typeof calendarProviderBindings.$inferSelect;
function selection(binding: Binding): GoogleCalendarSelection {
  return {
    bindingId: binding.id,
    localCalendarId: binding.localCalendarId,
    version: binding.version,
    selected: binding.selected,
  };
}

async function firstSelection(
  tx: DbOrTx,
  userId: string,
  input: GoogleCalendarSelectionInput,
  metadata: { name: string; timeZone: string },
  signal: AbortSignal,
): Promise<GoogleCalendarSelection> {
  const [calendar] = await tx
    .insert(calendars)
    .values({ ...metadata, ownerId: userId, source: "provider", isPrimary: false })
    .returning({ id: calendars.id });
  signal.throwIfAborted();
  if (calendar === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "provider calendar insert returned no row");
  const [binding] = await tx
    .insert(calendarProviderBindings)
    .values({
      userId,
      providerCalendarId: input.calendarId,
      localCalendarId: calendar.id,
      selected: true,
    })
    .returning();
  signal.throwIfAborted();
  if (binding === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "provider binding insert returned no row");
  return selection(binding);
}

async function changeSelection(
  tx: DbOrTx,
  binding: Binding,
  selected: boolean,
  signal: AbortSignal,
): Promise<Result<GoogleCalendarSelection, CalendarCatalogError>> {
  if (binding.selected === selected) return ok(selection(binding));
  const [updated] = await tx
    .update(calendarProviderBindings)
    .set({ selected, version: sql`${calendarProviderBindings.version} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(calendarProviderBindings.id, binding.id),
        eq(calendarProviderBindings.userId, binding.userId),
        eq(calendarProviderBindings.version, binding.version),
      ),
    )
    .returning();
  signal.throwIfAborted();
  return updated === undefined ? err({ kind: "conflict" }) : ok(selection(updated));
}

async function selectUnderOwnerLock(
  tx: DbOrTx,
  userId: string,
  input: GoogleCalendarSelectionInput,
  signal: AbortSignal,
): Promise<Result<GoogleCalendarSelection, CalendarCatalogError>> {
  const owner = await activeCalendarOwner(tx, userId, signal, true);
  if (!owner.ok) return owner;
  const providerCalendar = await loadOwnedProviderCalendar(tx, userId, input, signal);
  if (providerCalendar === undefined) return err({ kind: "not_found" });
  const [binding] = await tx
    .select()
    .from(calendarProviderBindings)
    .where(
      and(
        eq(calendarProviderBindings.providerCalendarId, input.calendarId),
        eq(calendarProviderBindings.userId, userId),
      ),
    )
    .for("update");
  signal.throwIfAborted();
  if ((binding?.version ?? null) !== input.expectedBindingVersion) return err({ kind: "conflict" });
  // Remove is a local ownership/CAS operation, including when the provider is unavailable.
  if (!input.selected)
    return binding === undefined
      ? err({ kind: "not_found" })
      : changeSelection(tx, binding, false, signal);
  const admitted = await admitCalendarSelectionAdd(tx, userId, input, providerCalendar, signal);
  if (!admitted.ok) return admitted;
  return binding === undefined
    ? ok(await firstSelection(tx, userId, input, admitted.value, signal))
    : changeSelection(tx, binding, true, signal);
}

export async function setGoogleCalendarSelection(
  db: Db,
  userId: string,
  raw: unknown,
  signal: AbortSignal,
): Promise<Result<GoogleCalendarSelection, CalendarCatalogError>> {
  signal.throwIfAborted();
  const parsed = googleCalendarSelectionInput.safeParse(raw);
  if (!parsed.success) return err({ kind: "invalid_input" });
  try {
    // Discovery, reconnect, disconnect and selection share the owner-first lock order.
    // First Add writes the dedicated calendar and binding inside this same transaction.
    return await db.transaction((tx) => selectUnderOwnerLock(tx, userId, parsed.data, signal));
  } catch (error) {
    rethrowGoogleAbort(error, signal);
    return err({ kind: "storage" });
  }
}
