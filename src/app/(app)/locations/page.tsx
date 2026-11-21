import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { locationsFixture } from "@/features/locations/fixtures";
import { LocationsFixture } from "@/features/locations/LocationsFixture";
import { LocationsLive } from "@/features/locations/LocationsLive";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function LocationsPage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  if (!actor.isActive) notFound();
  if (inventoryFixturesEnabled()) {
    return <LocationsFixture initial={locationsFixture} canManage={actor.type === "admin"} />;
  }

  const result = await coreClient()
    .locations.directory.query()
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  return <LocationsLive actorId={actor.id} result={result} />;
}
