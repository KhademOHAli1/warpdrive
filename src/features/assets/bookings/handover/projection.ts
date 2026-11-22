import type { AssetsWorkspace } from "../../contracts";
import type { Booking, BookingLine } from "../contracts";
import type { BookingState } from "../transitions";
import type {
  BookingHandoverAllocation,
  BookingHandoverRead,
  BookingPickupOption,
} from "./contracts";
import {
  emptyHandoverSession,
  type HandoverAllocation,
  type HandoverState,
  handoverLineKey,
  handoverStatus,
  pickedPhysicalIds,
  pickedQuantity,
} from "./fixtureState";
import { handoverPhysicalSources } from "./handoverCapacity";

export function handoverCustodians(assets: AssetsWorkspace, siteId: string) {
  return (assets.custody?.custodians ?? []).filter(
    ({ siteId: site, active, kind, staffId }) =>
      site === siteId &&
      active &&
      (kind === "non_login" || assets.custody?.staff.some(({ id }) => id === staffId) === true),
  );
}

export function handoverPickupOptions(
  { inventory, resources }: ReturnType<typeof handoverPhysicalSources>,
  siteId: string,
  line: BookingLine,
  remaining: number,
  picked: ReadonlySet<string>,
): BookingPickupOption[] {
  if (remaining <= 0) return [];
  const { kind, resourceId, locationId } = line;
  const eligible = resources.filter((row) => {
    if (row.siteId !== siteId || row.freeNow < 1) return false;
    if ((row.kind === "asset" || row.kind === "kit") && picked.has(row.resourceId)) return false;
    if (locationId !== null && row.locationId !== locationId) return false;
    if (kind === "model") {
      return (
        row.kind === "asset" &&
        inventory.assets.some(({ id, modelId }) => id === row.resourceId && modelId === resourceId)
      );
    }
    return (
      row.kind === kind &&
      row.resourceId === resourceId &&
      (kind !== "kit" || row.kitDefinitionVersion === line.kitDefinitionVersion)
    );
  });
  return eligible.map(({ resourceId: targetId, name, code, serial, freeNow }) => ({
    targetId,
    name,
    code,
    serial,
    available: Math.min(remaining, freeNow),
  }));
}

export function handoverBookingScope(
  state: Pick<BookingState, "bookings" | "sites" | "viewer">,
  bookingId: string,
) {
  const booking = state.bookings.find(({ id }) => id === bookingId);
  const site = state.sites.find(({ id }) => id === booking?.siteId);
  if (booking === undefined || site === undefined || booking.status !== "confirmed") return null;
  const manager = site.role === "manager";
  const owner =
    (site.role === "base" || site.role === "self_service") &&
    booking.requesterId === state.viewer.id;
  return manager || owner
    ? { booking, site, canOperate: manager && site.archived !== true && !booking.archived }
    : null;
}

export function pickupWindowOpen(booking: Booking, now: string) {
  const at = Date.parse(now);
  return Date.parse(booking.window.startAt) <= at && at < Date.parse(booking.window.endAt);
}

function projectAllocation(row: HandoverAllocation): BookingHandoverAllocation {
  const {
    id,
    lineKey,
    kind,
    targetId,
    name,
    code,
    serial,
    sourceLocationId,
    sourceBin,
    issued,
    outstanding,
    members,
  } = row;
  return {
    id,
    lineKey,
    kind,
    targetId,
    name,
    code,
    serial,
    sourceLocationId,
    sourceBin,
    issued,
    outstanding,
    members,
  };
}

export function projectHandover(
  bookings: BookingState,
  handovers: HandoverState,
  bookingId: string,
  now: string,
): BookingHandoverRead {
  const scope = handoverBookingScope(bookings, bookingId);
  if (scope === null) return { ok: false, error: "unavailable" };
  const { booking, site } = scope;
  const { assets } = handovers;
  const canOperate =
    scope.canOperate && assets.sites.some(({ id, canManage }) => id === site.id && canManage);
  const session = handovers.sessions[bookingId] ?? emptyHandoverSession;
  const status = handoverStatus(booking, session, now);
  const dueAt = booking.window.endAt;
  const pickupClosed = session.pickupClosed || Date.parse(dueAt) <= Date.parse(now);
  const canPickup = canOperate && !pickupClosed && pickupWindowOpen(booking, now);
  const sources = handoverPhysicalSources(handovers);
  const alreadyPicked = new Set([
    ...pickedPhysicalIds(session, "asset"),
    ...pickedPhysicalIds(session, "kit"),
  ]);
  const lines = booking.lines.map((line) => {
    const { kind, name, code, bin, quantity } = line;
    const key = handoverLineKey(line);
    const picked = pickedQuantity(session, key);
    return {
      key,
      kind,
      name,
      code,
      bin,
      quantity,
      picked,
      options: canPickup
        ? handoverPickupOptions(sources, site.id, line, quantity - picked, alreadyPicked)
        : [],
    };
  });
  return {
    ok: true,
    value: {
      bookingId,
      bookingVersion: booking.version,
      version: session.version,
      status,
      dueAt,
      canOperate,
      pickupClosed,
      custodian: session.custodian,
      custodians: canOperate
        ? handoverCustodians(assets, site.id).map(({ id, name }) => ({ id, name }))
        : [],
      locations: canOperate
        ? assets.locations
            .filter(({ siteId, archived }) => siteId === site.id && !archived)
            .map(({ id, name }) => ({ id, name }))
        : [],
      lines,
      allocations: session.allocations.map(projectAllocation),
      receipts: session.receipts,
      notices:
        status === "overdue" || status === "expired"
          ? [{ id: `${bookingId}:${status}:${dueAt}`, kind: status, dueAt, at: dueAt }]
          : [],
    },
  };
}

export { projectHandover as projectFixtureHandover };
