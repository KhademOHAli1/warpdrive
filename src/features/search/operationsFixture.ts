import { createBookingFixture } from "@/features/assets/bookings/fixtures";
import { projectBookings } from "@/features/assets/bookings/transitions";
import { locationsFixture } from "@/features/locations/fixtures";
import type { OperationsSearchFixtureEntry } from "./operationsContracts";

export function projectOperationsSearchFixture({
  id,
  name,
  canManage,
}: {
  id: string;
  name: string;
  canManage: boolean;
}): OperationsSearchFixtureEntry[] {
  const sites = new Map(
    locationsFixture.sites.filter(({ archived }) => !archived).map((site) => [site.id, site]),
  );
  const locations = locationsFixture.locations.flatMap((location) => {
    const site = sites.get(location.siteId);
    if (location.archived || site === undefined) return [];
    return [
      {
        id: location.id,
        kind: "location" as const,
        primary: location.name,
        secondary: `${location.code} · ${site.name}`,
      },
    ];
  });
  const bookingWorkspace = projectBookings(
    createBookingFixture({ id, name }, canManage, new Date().toISOString()),
  );
  const bookings = bookingWorkspace.bookings.flatMap((booking) => {
    const site = sites.get(booking.siteId);
    if (booking.archived || site === undefined) return [];
    return [
      { id: booking.id, kind: "booking" as const, primary: booking.title, secondary: site.name },
    ];
  });
  return [...locations, ...bookings];
}
