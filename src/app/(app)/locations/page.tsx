import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { locationsFixture } from "@/features/locations/fixtures";
import { LocationsFixture } from "@/features/locations/LocationsFixture";
import { createContext } from "@/frontend/context";

export default async function LocationsPage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  if (!actor.isActive || !inventoryFixturesEnabled()) notFound();

  return <LocationsFixture initial={locationsFixture} canManage={actor.type === "admin"} />;
}
