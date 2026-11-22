import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createBookingAutomationDemo } from "@/features/assets/bookings/automations/fixture";
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

function makeFixtureBookingState(
  mode: "handover" | "automations" | undefined,
  viewer: Parameters<typeof createBookingFixture>[0],
  admin: boolean,
  now: string,
) {
  switch (mode) {
    case "handover":
      return createBookingHandoverDemo(viewer, admin, now).state;
    case "automations":
      return createBookingAutomationDemo(viewer, admin, now).state;
    case undefined:
      return createBookingFixture(viewer, admin, now);
  }
}

function renderBookingFixture(
  viewer: Parameters<typeof createBookingFixture>[0],
  admin: boolean,
  mode: "handover" | "automations" | undefined,
  bookingId: string | undefined,
) {
  const initialNow = new Date().toISOString();
  if (bookingId !== undefined) {
    const state = makeFixtureBookingState(mode, viewer, admin, initialNow);
    if (!projectBookings(state).bookings.some(({ id }) => id === bookingId)) notFound();
  }
  return (
    <BookingsFixture
      key={`${viewer.id}:${mode ?? ""}:${bookingId ?? ""}`}
      actorId={viewer.id}
      actorName={viewer.name}
      admin={admin}
      initialNow={initialNow}
      initialBookingId={bookingId}
      handoverDemo={mode === "handover"}
      automationDemo={mode === "automations"}
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
      query.demo === "handover" || query.demo === "automations" ? query.demo : undefined,
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
