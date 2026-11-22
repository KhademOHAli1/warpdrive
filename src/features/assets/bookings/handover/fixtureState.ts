import type { AssetsWorkspace } from "../../contracts";
import { emptyCustodyWorkspace } from "../../custody/contracts";
import { emptyKitWorkspace } from "../../kits/contracts";
import type { Booking, BookingDemand, BookingLine } from "../contracts";
import type {
  BookingHandoverAllocation,
  BookingHandoverReceipt,
  BookingHandoverStatus,
} from "./contracts";

export type HandoverFixtureAllocation = BookingHandoverAllocation & {
  holdingId: string | null;
  checkoutId: string | null;
};

export type HandoverFixtureSession = {
  version: number;
  pickupClosed: boolean;
  custodian: { id: string; name: string } | null;
  allocations: HandoverFixtureAllocation[];
  receipts: BookingHandoverReceipt[];
};

export type HandoverInspectionHold = {
  allocationId: string;
  siteId: string;
  targetId: string;
  locationId: string;
  quantity: number;
  condition: "damaged" | "needs_inspection";
};

export type HandoverFixtureState = {
  assets: AssetsWorkspace;
  sessions: Readonly<Record<string, HandoverFixtureSession>>;
  inspection: readonly HandoverInspectionHold[];
  requests: Readonly<Record<string, string>>;
};

export const emptyFixtureSession: HandoverFixtureSession = {
  version: 0,
  pickupClosed: false,
  custodian: null,
  allocations: [],
  receipts: [],
};

export function createHandoverFixture(assets: AssetsWorkspace): HandoverFixtureState {
  return {
    assets: {
      ...assets,
      custody: assets.custody ?? emptyCustodyWorkspace(),
      kits: assets.kits ?? emptyKitWorkspace(),
    },
    sessions: {},
    inspection: [],
    requests: {},
  };
}

export function hasFixtureHandover(state: HandoverFixtureState, bookingId: string) {
  return state.sessions[bookingId] !== undefined;
}

export function handoverLineKey({ kind, resourceId, locationId }: BookingDemand) {
  return `${kind}:${resourceId}:${locationId ?? ""}`;
}

export function pickedQuantity(session: HandoverFixtureSession, key: string) {
  return session.allocations.reduce(
    (total, item) => total + (item.lineKey === key ? item.issued : 0),
    0,
  );
}

export function pickedPhysicalIds(session: HandoverFixtureSession, kind: "asset" | "kit") {
  return session.allocations.flatMap((row) => (row.kind === kind ? [row.targetId] : []));
}

export function remainingPickup(booking: Booking, session: HandoverFixtureSession): BookingLine[] {
  if (session.pickupClosed) return [];
  return booking.lines.flatMap((line) => {
    const quantity = line.quantity - pickedQuantity(session, handoverLineKey(line));
    return quantity > 0 ? [{ ...line, quantity }] : [];
  });
}

export function fixtureHandoverStatus(
  booking: Booking,
  session: HandoverFixtureSession,
  now: string,
): BookingHandoverStatus {
  const deadlinePassed = Date.parse(booking.window.endAt) <= Date.parse(now);
  if (session.allocations.some(({ outstanding }) => outstanding > 0)) {
    return deadlinePassed ? "overdue" : "ongoing";
  }
  if (session.allocations.length === 0 && deadlinePassed && !session.pickupClosed) return "expired";
  if (session.pickupClosed || deadlinePassed) return "completed";
  return session.allocations.length > 0 ? "ongoing" : "ready";
}
