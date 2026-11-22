import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { type HydratedActor, hydrateActor } from "@/server/hydrateActor";
import { assetActor, lockAssetRegister } from "../service";
import { type BookingCalendarEvent, renderBookingCalendar } from "./calendar";
import type { Booking, BookingSite } from "./contracts";
import {
  type BookingFeed,
  type BookingFeedCommand,
  type BookingFeedResult,
  bookingCalendarId,
  bookingFeedCommand,
} from "./feedContracts";
import { bookingRecords } from "./repository";
import { assetBookingFeeds, type BookingFeedScope } from "./schema";
import { bookingSites } from "./scope";

const feeds = assetBookingFeeds;
const unavailable = { ok: false, error: "unavailable" } as const;
const invalid = { ok: false, error: "invalid" } as const;
const conflict = { ok: false, error: "conflict" } as const;

class BookingFeedSessionExpired extends Error {}

function tokenHash(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function canUseFeed(actor: HydratedActor, site: BookingSite, scope: BookingFeedScope) {
  return (
    site.archived !== true &&
    (scope === "site" ? actor.type === "admin" && site.canConfigure : site.role !== "viewer")
  );
}

async function readFeedAt(tx: Db, id: string) {
  const [row] = await tx.select().from(feeds).where(eq(feeds.id, id));
  return row;
}

async function listFeedsAt(tx: Db, actorId: string, siteId: string): Promise<BookingFeed[]> {
  const rows = await tx
    .select({
      id: feeds.id,
      siteId: feeds.siteId,
      scope: feeds.scope,
      createdAt: feeds.createdAt,
      revokedAt: feeds.revokedAt,
    })
    .from(feeds)
    .where(and(eq(feeds.actorId, actorId), eq(feeds.siteId, siteId)))
    .orderBy(desc(feeds.createdAt), asc(feeds.id));
  return rows.map(({ createdAt, revokedAt, ...row }) => ({
    ...row,
    createdAt: createdAt.toISOString(),
    revokedAt: revokedAt?.toISOString() ?? null,
  }));
}

async function projectFeeds(
  tx: Db,
  actorId: string,
  siteId: string,
  created: { id: string; secret: string } | null = null,
): Promise<BookingFeedResult> {
  return { ok: true, feeds: await listFeedsAt(tx, actorId, siteId), created };
}

async function createFeed(
  tx: Db,
  actor: HydratedActor,
  site: BookingSite,
  { requestId, scope }: Extract<BookingFeedCommand, { type: "create" }>,
): Promise<BookingFeedResult> {
  if (!canUseFeed(actor, site, scope)) return unavailable;
  const previous = await readFeedAt(tx, requestId);
  if (previous !== undefined) {
    if (previous.actorId !== actor.id || previous.siteId !== site.id) return unavailable;
    if (previous.scope !== scope) return conflict;
    return projectFeeds(tx, actor.id, site.id);
  }
  const secret = `wd_booking_${randomBytes(32).toString("base64url")}`;
  await tx.insert(feeds).values({
    id: requestId,
    siteId: site.id,
    actorId: actor.id,
    scope,
    secretDigest: tokenHash(secret),
  });
  return projectFeeds(tx, actor.id, site.id, { id: requestId, secret });
}

async function revokeFeed(tx: Db, actorId: string, siteId: string, feedId: string) {
  const previous = await readFeedAt(tx, feedId);
  if (previous?.actorId !== actorId || previous.siteId !== siteId) return unavailable;
  if (previous.revokedAt === null) {
    await tx
      .update(feeds)
      .set({ revokedAt: sql`clock_timestamp()` })
      .where(and(eq(feeds.id, feedId), isNull(feeds.revokedAt)));
  }
  return projectFeeds(tx, actorId, siteId);
}

async function applyCommand(
  tx: Db,
  actor: HydratedActor,
  command: BookingFeedCommand,
): Promise<BookingFeedResult> {
  const site = (await bookingSites(tx, actor)).find(({ id }) => id === command.siteId);
  if (site === undefined || site.archived === true || site.role === "viewer") return unavailable;
  switch (command.type) {
    case "list":
      return projectFeeds(tx, actor.id, site.id);
    case "create":
      return createFeed(tx, actor, site, command);
    case "revoke":
      return revokeFeed(tx, actor.id, site.id, command.feedId);
  }
}

export async function runBookingFeedCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<BookingFeedResult> {
  const parsed = bookingFeedCommand.safeParse(raw);
  if (!parsed.success) return invalid;
  const mode = parsed.data.type === "list" ? "read" : "write";
  try {
    return await withCurrentAuthority(db, mode, signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      const result = await applyCommand(tx, actor, parsed.data);
      if ((await assetActor(tx, who, signal)) === null) throw new BookingFeedSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof BookingFeedSessionExpired) return unavailable;
    throw error;
  }
}

function calendarEvent(
  booking: Booking,
  status: NonNullable<BookingCalendarEvent["status"]>,
  id: string,
  summary?: string,
): BookingCalendarEvent {
  return {
    id,
    startsAt: booking.window.startAt,
    endsAt: booking.window.endAt,
    updatedAt: booking.updatedAt,
    version: booking.version,
    status,
    ...(summary === undefined ? {} : { summary }),
  };
}

function visibleBooking(booking: Booking, site: BookingSite, actorId: string) {
  return (
    site.role === "manager" ||
    ((site.role === "base" || site.role === "self_service") && booking.requesterId === actorId)
  );
}

export async function readBookingCalendarDownload(
  db: Db,
  who: NativeSessionRef,
  bookingId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const parsed = bookingCalendarId.safeParse(bookingId);
  if (!parsed.success) return null;
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    const actor = await assetActor(tx, who, signal);
    if (actor === null) return null;
    const sites = new Map((await bookingSites(tx, actor)).map((site) => [site.id, site]));
    await lockAssetRegister(tx, "read", signal);
    const records = await bookingRecords(tx, [...sites.keys()], false);
    const booking = records.find(({ id }) => id === parsed.data);
    if (booking === undefined || booking.status === "draft") return null;
    const site = sites.get(booking.siteId);
    if (site === undefined || !visibleBooking(booking, site, actor.id)) return null;
    if ((await assetActor(tx, who, signal)) === null) return null;
    const status = booking.status === "pending" ? "tentative" : booking.status;
    return renderBookingCalendar([calendarEvent(booking, status, booking.id, booking.title)]);
  });
}

async function currentFeedActor(tx: Db, actorId: string, signal: AbortSignal) {
  const [staff] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, actorId),
        eq(users.isActive, true),
        isNull(users.invitedAt),
        eq(users.projectsGuestOnly, false),
      ),
    );
  return staff === undefined ? null : hydrateActor(tx, staff.id, signal);
}

/** Stable per feed, without exposing the booking's internal UID to shared calendars. */
function siteCalendarId(feedId: string, bookingId: string) {
  const value = createHash("sha256")
    .update("warpdrive-booking-feed-v1:")
    .update(feedId)
    .update(":")
    .update(bookingId)
    .digest("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-8${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

export async function readBookingCalendarSubscription(
  db: Db,
  feedId: string,
  secret: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  const parsed = bookingCalendarId.safeParse(feedId);
  if (!parsed.success || secret === null || !/^wd_booking_[A-Za-z0-9_-]{43}$/u.test(secret))
    return null;
  const digest = Buffer.from(tokenHash(secret), "hex");
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    const feed = await readFeedAt(tx, parsed.data);
    if (
      feed === undefined ||
      feed.revokedAt !== null ||
      !timingSafeEqual(Buffer.from(feed.secretDigest, "hex"), digest)
    )
      return null;

    const actor = await currentFeedActor(tx, feed.actorId, signal);
    if (actor === null) return null;
    const site = (await bookingSites(tx, actor)).find(({ id }) => id === feed.siteId);
    if (site === undefined || !canUseFeed(actor, site, feed.scope)) return null;

    await lockAssetRegister(tx, "read", signal);
    const records = (await bookingRecords(tx, [site.id], false)).filter(
      (booking) =>
        booking.status === "confirmed" &&
        !booking.archived &&
        (feed.scope === "site" || booking.requesterId === actor.id),
    );
    return renderBookingCalendar(
      records.map((booking) =>
        feed.scope === "site"
          ? calendarEvent(booking, "confirmed", siteCalendarId(feed.id, booking.id))
          : calendarEvent(booking, "confirmed", booking.id, booking.title),
      ),
    );
  });
}

export function bookingCalendarResponse(content: string | null, download = false): Response {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
  });
  if (content === null) return new Response(null, { status: 404, headers });
  headers.set("content-type", "text/calendar; charset=utf-8");
  if (download) headers.set("content-disposition", 'attachment; filename="booking.ics"');
  return new Response(content, { headers });
}
