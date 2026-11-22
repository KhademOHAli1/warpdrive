import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { BookingsFixture } from "@/features/assets/bookings/BookingsFixture";
import { BookingsLive } from "@/features/assets/bookings/BookingsLive";
import {
  createBookingFixture,
  createBookingHandoverDemo,
} from "@/features/assets/bookings/fixtures";
import { projectBookings } from "@/features/assets/bookings/transitions";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

const bookingFocus = z.uuid().toLowerCase().optional();

function renderBookingFixture(
  viewer: Parameters<typeof createBookingFixture>[0],
  admin: boolean,
  handoverDemo: boolean,
  bookingId: string | undefined,
) {
  const initialNow = new Date().toISOString();
  if (bookingId !== undefined) {
    const state = handoverDemo
      ? createBookingHandoverDemo(viewer, admin, initialNow).state
      : createBookingFixture(viewer, admin, initialNow);
    if (!projectBookings(state).bookings.some(({ id }) => id === bookingId)) notFound();
  }
  return (
    <BookingsFixture
      key={`${viewer.id}:${handoverDemo ? "handover" : ""}:${bookingId ?? ""}`}
      actorId={viewer.id}
      actorName={viewer.name}
      admin={admin}
      initialNow={initialNow}
      initialBookingId={bookingId}
      handoverDemo={handoverDemo}
    />
  );
}

export default async function AssetBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string | string[]; bookingId?: string | string[] }>;
}) {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly) notFound();
  const query = await searchParams;
  const focus = bookingFocus.safeParse(query.bookingId);
  if (!focus.success) notFound();
  const bookingId = focus.data;
  if (inventoryFixturesEnabled())
    return renderBookingFixture(
      actor,
      actor.type === "admin",
      query.demo === "handover",
      bookingId,
    );

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
  if (bookingId !== undefined && !result.value.bookings.some(({ id }) => id === bookingId))
    notFound();
  return (
    <BookingsLive
      key={`${actor.id}:${bookingId ?? ""}`}
      actorId={actor.id}
      initial={result.value}
      initialBookingId={bookingId}
      canBrowseAssets={shell?.assetsAvailable === true}
      initialMemberships={membership?.ok === true ? membership.value : undefined}
    />
  );
}
