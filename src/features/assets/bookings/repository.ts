import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import type {
  Booking,
  BookingDemand,
  BookingEvent,
  BookingLine,
  BookingMaintenance,
  BookingSite,
} from "./contracts";
import {
  assetBookingEvents,
  assetBookingLines,
  assetBookingMaintenance,
  assetBookingPolicies,
  assetBookings,
} from "./schema";
import type { BookingState } from "./transitions";

type ResourceColumns = {
  kind: BookingDemand["kind"];
  assetId: string | null;
  modelId: string | null;
  kitId: string | null;
  locationId: string | null;
  quantity: number;
};

function resourceColumns({
  kind,
  resourceId,
  locationId,
  quantity,
}: BookingDemand): ResourceColumns {
  return {
    kind,
    assetId:
      kind === "asset" || kind === "returnable_pool" || kind === "consumable_pool"
        ? resourceId
        : null,
    modelId: kind === "model" ? resourceId : null,
    kitId: kind === "kit" ? resourceId : null,
    locationId,
    quantity,
  };
}

function publicDemand({
  kind,
  assetId,
  modelId,
  kitId,
  locationId,
  quantity,
}: ResourceColumns): BookingDemand {
  const resourceId = assetId ?? modelId ?? kitId;
  if (resourceId === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "A booking line lost its resource");
  return { kind, resourceId, locationId, quantity };
}

type Line = typeof assetBookingLines.$inferSelect;
function publicLine(row: Line): BookingLine {
  const { name, code, bin, serial, contents, kitDefinitionVersion } = row;
  return { ...publicDemand(row), name, code, bin, serial, contents, kitDefinitionVersion };
}

function group<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const prior = groups.get(id);
    if (prior === undefined) groups.set(id, [row]);
    else prior.push(row);
  }
  return groups;
}

async function historyAt(tx: Db, siteIds: string[]) {
  const events = assetBookingEvents;
  const history = await tx
    .select({
      bookingId: events.bookingId,
      version: events.version,
      kind: events.kind,
      actor: users.name,
      at: events.at,
      reason: events.reason,
    })
    .from(events)
    .leftJoin(users, eq(events.actorId, users.id))
    .where(inArray(events.siteId, siteIds))
    .orderBy(desc(events.version));
  return group(history, ({ bookingId }) => bookingId);
}

export async function bookingRecords(
  tx: Db,
  siteIds: string[],
  includeHistory: boolean,
  activeAt?: string,
) {
  if (siteIds.length === 0) return [];
  const bookings = await tx
    .select()
    .from(assetBookings)
    .where(
      and(
        inArray(assetBookings.siteId, siteIds),
        activeAt === undefined
          ? undefined
          : and(
              inArray(assetBookings.status, ["pending", "confirmed"]),
              eq(assetBookings.archived, false),
              gt(assetBookings.endAt, new Date(activeAt)),
            ),
      ),
    )
    .orderBy(desc(assetBookings.updatedAt), asc(assetBookings.id));
  if (bookings.length === 0) return [];
  const lines = await tx
    .select()
    .from(assetBookingLines)
    .where(
      inArray(
        assetBookingLines.bookingId,
        bookings.map(({ id }) => id),
      ),
    )
    .orderBy(asc(assetBookingLines.position));
  const byBooking = group(lines, ({ bookingId }) => bookingId);
  const events = includeHistory ? await historyAt(tx, siteIds) : undefined;
  return bookings.map(
    ({ startAt, endAt, updatedAt, ...row }): Booking => ({
      ...row,
      updatedAt: updatedAt.toISOString(),
      window: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
      lines: (byBooking.get(row.id) ?? []).map(publicLine),
      history: (events?.get(row.id) ?? []).map(
        ({ version, kind, actor, at, reason }): BookingEvent => ({
          version,
          kind,
          actor: actor ?? "",
          at: at.toISOString(),
          reason,
        }),
      ),
    }),
  );
}

export async function bookingMaintenance(
  tx: Db,
  siteIds: string[],
  activeAt?: string,
): Promise<BookingMaintenance[]> {
  if (siteIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(assetBookingMaintenance)
    .where(
      and(
        inArray(assetBookingMaintenance.siteId, siteIds),
        activeAt === undefined
          ? undefined
          : and(
              eq(assetBookingMaintenance.cancelled, false),
              gt(assetBookingMaintenance.endAt, new Date(activeAt)),
            ),
      ),
    )
    .orderBy(asc(assetBookingMaintenance.startAt), asc(assetBookingMaintenance.id));
  return rows.map((row) => ({
    id: row.id,
    siteId: row.siteId,
    version: row.version,
    title: row.title,
    cancelled: row.cancelled,
    window: { startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString() },
    demand: publicDemand(row),
  }));
}

function bookingColumns(booking: Booking) {
  const {
    id,
    siteId,
    title,
    description,
    requesterId,
    requesterName,
    requesterRole,
    window,
    status,
    archived,
    updatedAt,
    version,
  } = booking;
  return {
    id,
    siteId,
    title,
    description,
    requesterId,
    requesterName,
    requesterRole,
    status,
    archived,
    version,
    startAt: new Date(window.startAt),
    endAt: new Date(window.endAt),
    updatedAt: new Date(updatedAt),
  };
}

async function persistBooking(
  tx: Db,
  prior: Booking | undefined,
  booking: Booking,
  actorId: string,
  preserveLines = false,
) {
  if (prior === undefined) {
    await tx.insert(assetBookings).values(bookingColumns(booking));
  } else {
    const updated = await tx
      .update(assetBookings)
      .set(bookingColumns(booking))
      .where(and(eq(assetBookings.id, booking.id), eq(assetBookings.version, prior.version)))
      .returning({ id: assetBookings.id });
    if (updated.length !== 1)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking changed under its write lock");
    if (!preserveLines) {
      await tx.delete(assetBookingLines).where(eq(assetBookingLines.bookingId, booking.id));
    }
  }
  if (!preserveLines && booking.lines.length > 0) {
    await tx.insert(assetBookingLines).values(
      booking.lines.map((line, position) => {
        const { name, code, bin, serial, contents, kitDefinitionVersion } = line;
        return {
          ...resourceColumns(line),
          siteId: booking.siteId,
          bookingId: booking.id,
          position,
          name,
          code,
          bin,
          serial,
          contents,
          kitDefinitionVersion,
        };
      }),
    );
  }
  const event = booking.history[0];
  if (event === undefined || event.version !== booking.version)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking mutation did not record its activity");
  const { title, window, status, archived, lines } = booking;
  await tx.insert(assetBookingEvents).values({
    bookingId: booking.id,
    siteId: booking.siteId,
    version: event.version,
    actorId,
    at: new Date(event.at),
    kind: event.kind,
    reason: event.reason,
    snapshot: { title, window, status, archived, lines },
  });
}

async function persistPolicy(tx: Db, previous: BookingSite, next: BookingSite) {
  if (next.policyVersion === previous.policyVersion) return;
  const values = { siteId: next.id, policy: next.policy, version: next.policyVersion };
  const updated = await tx
    .insert(assetBookingPolicies)
    .values(values)
    .onConflictDoUpdate({
      target: assetBookingPolicies.siteId,
      set: { policy: next.policy, version: next.policyVersion },
      setWhere: eq(assetBookingPolicies.version, previous.policyVersion),
    })
    .returning({ version: assetBookingPolicies.version });
  if (updated.length !== 1)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking policy changed under its write lock");
}

async function persistMaintenance(
  tx: Db,
  before: BookingMaintenance | undefined,
  row: BookingMaintenance,
) {
  const { id, siteId, version, title, window, demand, cancelled } = row;
  const values = {
    id,
    siteId,
    version,
    title,
    cancelled,
    startAt: new Date(window.startAt),
    endAt: new Date(window.endAt),
    ...resourceColumns(demand),
  };
  const written = await tx
    .insert(assetBookingMaintenance)
    .values(values)
    .onConflictDoUpdate({
      target: assetBookingMaintenance.id,
      set: values,
      setWhere:
        before === undefined ? sql`false` : eq(assetBookingMaintenance.version, before.version),
    })
    .returning({ id: assetBookingMaintenance.id });
  if (written.length !== 1)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Maintenance changed under its write lock");
}

export function persistBookingDeadline(tx: Db, prior: Booking, after: Booking, actorId: string) {
  if (prior.lines !== after.lines) {
    throw new AppError(
      ERROR_IDS.DB_INVARIANT,
      "A due amendment replaced the approved booking lines",
    );
  }
  return persistBooking(tx, prior, after, actorId, true);
}

export async function persistBookingState(
  tx: Db,
  before: BookingState,
  after: BookingState,
  actorId: string,
) {
  const policies = new Map(before.sites.map((site) => [site.id, site]));
  for (const site of after.sites) {
    const prior = policies.get(site.id);
    if (prior !== undefined) await persistPolicy(tx, prior, site);
  }
  const bookings = new Map(before.bookings.map((record) => [record.id, record]));
  for (const booking of after.bookings) {
    const prior = bookings.get(booking.id);
    if (prior?.version !== booking.version) await persistBooking(tx, prior, booking, actorId);
  }
  const maintenance = new Map(before.maintenance.map((record) => [record.id, record]));
  for (const record of after.maintenance) {
    const prior = maintenance.get(record.id);
    if (prior?.version !== record.version) await persistMaintenance(tx, prior, record);
  }
}
