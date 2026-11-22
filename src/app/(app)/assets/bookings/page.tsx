import { notFound, redirect } from "next/navigation";
import { BookingsFixture } from "@/features/assets/bookings/BookingsFixture";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext } from "@/frontend/context";

export default async function AssetBookingsPage() {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly || !inventoryFixturesEnabled()) notFound();
  return (
    <BookingsFixture
      key={actor.id}
      actorId={actor.id}
      actorName={actor.name}
      admin={actor.type === "admin"}
    />
  );
}
