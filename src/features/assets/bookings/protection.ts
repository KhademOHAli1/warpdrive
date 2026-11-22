import type { Db } from "@/db/client";
import type { AssetsWorkspace } from "../contracts";
import { planBookingCapacity } from "./availability";
import { bookingMaintenance, bookingRecords } from "./repository";
import { assetBookingSources } from "./resources";
import { bookingCommitments } from "./transitions";

async function protectedCommitments(tx: Db, siteId: string, at: string) {
  const bookings = await bookingRecords(tx, [siteId], false, at);
  const maintenance = await bookingMaintenance(tx, [siteId], at);
  return bookingCommitments({ bookings, maintenance }, siteId);
}

export type BookingCapacityGuard = (changed: AssetsWorkspace) => boolean;

/** The directory and Asset write fences govern both the physical and dated ledgers. */
export async function bookingCapacityGuard(
  tx: Db,
  siteId: string,
): Promise<BookingCapacityGuard | undefined> {
  const asOf = new Date().toISOString();
  const held = await protectedCommitments(tx, siteId, asOf);
  if (held.length === 0) return undefined;
  return (changed) =>
    planBookingCapacity(assetBookingSources(changed).inventory, held, { asOf }).ok;
}

/** Called under the directory's exclusive write lock. */
export async function hasActiveBookingPlacement(
  tx: Db,
  siteId: string,
  locationId: string | null,
): Promise<boolean> {
  const held = await protectedCommitments(tx, siteId, new Date().toISOString());
  return locationId === null
    ? held.length > 0
    : held.some(({ demands }) => demands.some((line) => line.locationId === locationId));
}
