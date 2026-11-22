import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { BookingsFixture } from "@/features/assets/bookings/BookingsFixture";
import { BookingsLive } from "@/features/assets/bookings/BookingsLive";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function AssetBookingsPage() {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly) notFound();
  if (inventoryFixturesEnabled()) {
    return (
      <BookingsFixture
        key={actor.id}
        actorId={actor.id}
        actorName={actor.name}
        admin={actor.type === "admin"}
        initialNow={new Date().toISOString()}
      />
    );
  }

  const bookings = coreClient().assets.bookings;
  const [result, membership, { shell }] = await Promise.all([
    bookings.workspace.query().catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    }),
    actor.type === "admin"
      ? bookings.memberships.query().catch((error) => {
          if (!(error instanceof TRPCClientError)) throw error;
          return { ok: false, error: "unavailable" } as const;
        })
      : null,
    getBootstrap(),
  ]);
  if (!result.ok || (result.value.sites.length === 0 && actor.type !== "admin")) notFound();
  return (
    <BookingsLive
      key={actor.id}
      actorId={actor.id}
      initial={result.value}
      canBrowseAssets={shell?.assetsAvailable === true}
      initialMemberships={membership?.ok === true ? membership.value : undefined}
    />
  );
}
