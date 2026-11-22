import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { assetActor, lockAssetRegister } from "../service";
import {
  type BookingAvailabilityInput,
  type BookingAvailabilityResult,
  type BookingCommand,
  type BookingResult,
  type BookingSite,
  bookingAvailabilityInput,
  bookingCommand,
} from "./contracts";
import { type HandoverState, handoverStatus } from "./handover/fixtureState";
import { handoverCapacity } from "./handover/handoverCapacity";
import { loadHandoverState } from "./handover/repository";
import { nativeBookingAssets } from "./nativeResources";
import { bookingMaintenance, bookingRecords, persistBookingState } from "./repository";
import { assetBookingSources } from "./resources";
import { assetBookingReceipts } from "./schema";
import { bookingSites } from "./scope";
import {
  applyBookingCommand,
  type BookingState,
  previewBookingAvailability,
  projectBookings,
} from "./transitions";

const unavailable = { ok: false, error: "unavailable" } as const;
const invalid = { ok: false, error: "invalid" } as const;
const conflict = { ok: false, error: "conflict" } as const;

class BookingSessionExpired extends Error {}

async function bookingSnapshot(
  tx: Db,
  actor: HydratedActor,
  sites: BookingSite[],
  withHistory: boolean,
  now: string,
) {
  const siteIds = sites.map(({ id }) => id);
  const viewer = { id: actor.id, name: actor.name };
  const assets = await nativeBookingAssets(
    tx,
    sites.map(({ id, code, name }) => ({ id, code, name, canManage: false })),
  );
  const bookings = await bookingRecords(tx, siteIds, withHistory);
  const maintenance = await bookingMaintenance(tx, siteIds);
  const handovers = await loadHandoverState(tx, assets, siteIds);
  const state = { viewer, sites, bookings, maintenance, ...assetBookingSources(assets) };
  const capacity = handoverCapacity(state, handovers, now);
  return {
    handovers,
    capacity,
    state: { ...state, resources: capacity.resources },
  };
}

function projectWorkspace(state: BookingState) {
  return { ...projectBookings(state), handoverAvailable: true } as const;
}

export function readBookingWorkspace(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<BookingResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    const actor = await assetActor(tx, who, signal);
    if (actor === null) return unavailable;
    await lockAssetRegister(tx, "read", signal);
    const { state } = await bookingSnapshot(
      tx,
      actor,
      await bookingSites(tx, actor),
      true,
      new Date().toISOString(),
    );
    const value = projectWorkspace(state);
    const current = await assetActor(tx, who, signal);
    return current === null ? unavailable : { ok: true, value, bookingId: null };
  });
}

async function availability(tx: Db, actor: HydratedActor, input: BookingAvailabilityInput) {
  const site = (await bookingSites(tx, actor)).find(({ id }) => id === input.siteId);
  if (site === undefined || site.archived === true) return unavailable;
  const now = new Date().toISOString();
  const { state, capacity } = await bookingSnapshot(tx, actor, [site], false, now);
  return previewBookingAvailability(state, input, now, capacity);
}

export function checkBookingAvailability(
  db: Db,
  who: NativeSessionRef,
  input: unknown,
  signal: AbortSignal,
): Promise<BookingAvailabilityResult> {
  const parsed = bookingAvailabilityInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(invalid);
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    const actor = await assetActor(tx, who, signal);
    if (actor === null) return unavailable;
    await lockAssetRegister(tx, "read", signal);
    const result = await availability(tx, actor, parsed.data);
    return (await assetActor(tx, who, signal)) === null ? unavailable : result;
  });
}

function mayWrite(site: BookingSite, command: BookingCommand) {
  if (site.archived === true || site.role === "viewer") return false;
  if (command.type === "savePolicy") return site.role === "manager" && site.canConfigure;
  if (
    command.type === "reviewBooking" ||
    command.type === "saveMaintenance" ||
    command.type === "cancelMaintenance"
  )
    return site.role === "manager";
  return true;
}

async function projectCommand(
  tx: Db,
  actor: HydratedActor,
  sites: BookingSite[],
  bookingId: string | null,
) {
  const { state } = await bookingSnapshot(tx, actor, sites, true, new Date().toISOString());
  const value = projectWorkspace(state);
  if (bookingId !== null && !value.bookings.some(({ id }) => id === bookingId)) return unavailable;
  return { ok: true, value, bookingId } as const;
}

function permitsExistingBookingCommand(
  command: BookingCommand,
  state: BookingState,
  handovers: HandoverState,
  now: string,
) {
  if (!("bookingId" in command) || command.bookingId === null) return true;
  const handover = handovers.sessions[command.bookingId];
  const booking = state.bookings.find(({ id }) => id === command.bookingId);
  if (handover === undefined || booking === undefined) return true;
  if (state.sites[0]?.role !== "manager" && booking.requesterId !== state.viewer.id) return true;
  if (command.type === "saveBooking" || command.type === "cancelBooking") return false;
  if (command.type !== "archiveBooking" || !command.archived) return true;
  return handoverStatus(booking, handover, now) === "completed";
}

async function run(tx: Db, actor: HydratedActor, command: BookingCommand): Promise<BookingResult> {
  const sites = await bookingSites(tx, actor);
  const site = sites.find(({ id }) => id === command.siteId);
  if (site === undefined || !mayWrite(site, command)) return unavailable;
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const receipts = assetBookingReceipts;
  const [prior] = await tx
    .select()
    .from(receipts)
    .where(and(eq(receipts.actorId, actor.id), eq(receipts.requestId, command.requestId)));
  if (prior !== undefined) {
    if (prior.siteId !== site.id || prior.fingerprint !== fingerprint) return conflict;
    return projectCommand(tx, actor, sites, prior.bookingId);
  }
  const now = new Date().toISOString();
  const {
    state: before,
    handovers,
    capacity,
  } = await bookingSnapshot(tx, actor, [site], false, now);
  if (!permitsExistingBookingCommand(command, before, handovers, now)) {
    return { ok: false, error: "state" };
  }
  const result = applyBookingCommand(before, command, {
    now,
    makeId: () => crypto.randomUUID(),
    capacity,
  });
  if (!result.ok) return result;
  await persistBookingState(tx, before, result.state, actor.id);
  await tx.insert(receipts).values({
    actorId: actor.id,
    requestId: command.requestId,
    siteId: site.id,
    bookingId: result.bookingId,
    fingerprint,
  });
  return projectCommand(tx, actor, await bookingSites(tx, actor), result.bookingId);
}

export async function runBookingCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<BookingResult> {
  const parsed = bookingCommand.safeParse(raw);
  if (!parsed.success) return invalid;
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      await lockAssetRegister(tx, "write", signal);
      const result = await run(tx, actor, parsed.data);
      if ((await assetActor(tx, who, signal)) === null) throw new BookingSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof BookingSessionExpired) return unavailable;
    throw error;
  }
}
