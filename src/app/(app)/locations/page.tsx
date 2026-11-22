import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import type { LocationDirectory } from "@/features/locations/directory";
import { locationsFixture } from "@/features/locations/fixtures";
import { LocationsFixture } from "@/features/locations/LocationsFixture";
import { LocationsLive } from "@/features/locations/LocationsLive";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

const locationFocus = z.uuid().toLowerCase().optional();

function includesLocation(directory: LocationDirectory, locationId: string) {
  const location = directory.locations.find(({ id }) => id === locationId);
  return location !== undefined && directory.sites.some(({ id }) => id === location.siteId);
}

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string | string[] }>;
}) {
  const { actor, projectGuest } = await createContext();
  const { locationId } = await searchParams;
  if (locationId !== undefined && (projectGuest !== null || actor?.projectsGuestOnly === true))
    notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive) notFound();
  const selected = locationFocus.safeParse(locationId);
  if (!selected.success) notFound();
  const initialLocationId = selected.data;
  if (inventoryFixturesEnabled()) {
    if (initialLocationId !== undefined && !includesLocation(locationsFixture, initialLocationId))
      notFound();
    return (
      <LocationsFixture
        key={actor.id}
        initial={locationsFixture}
        canManage={actor.type === "admin"}
        initialLocationId={initialLocationId}
      />
    );
  }

  const result = await coreClient()
    .locations.directory.query()
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  if (
    initialLocationId !== undefined &&
    (!result.ok || !includesLocation(result.value.directory, initialLocationId))
  )
    notFound();
  return <LocationsLive actorId={actor.id} result={result} initialLocationId={initialLocationId} />;
}
