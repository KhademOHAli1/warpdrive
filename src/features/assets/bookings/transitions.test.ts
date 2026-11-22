import { expect, it } from "vitest";
import { wallTimeToInstant } from "@/lib/zonedDateTime";
import type { Booking, BookingDemand, BookingIntent, BookingWindow } from "./contracts";
import { createBookingFixture, type FixtureRole, fixtureBookingScope } from "./fixtures";
import {
  applyBookingCommand,
  type BookingState,
  previewBookingAvailability,
  projectBookings,
} from "./transitions";
import { validateBookingWindow } from "./workingHours";

const user = { id: "5900afd8-320d-4692-8bad-42d634b2ad59", name: "Booking operator" };
const now = "2026-11-23T07:00:00.000Z";

function siteWindow(startDate: string, start: string, endDate: string, end: string): BookingWindow {
  return {
    startAt: wallTimeToInstant(startDate, start, "Europe/Berlin").iso,
    endAt: wallTimeToInstant(endDate, end, "Europe/Berlin").iso,
  };
}

function seed() {
  const state = createBookingFixture(user, true, now);
  const booking = state.bookings[0];
  const site = state.sites.find(({ id }) => id === booking?.siteId);
  if (booking === undefined || site === undefined) throw new Error("Missing demo booking or site");
  return { state, site, booking };
}

function apply(state: BookingState, role: FixtureRole, intent: BookingIntent) {
  const scoped = fixtureBookingScope(state, user, role);
  return applyBookingCommand(
    scoped,
    { ...intent, requestId: crypto.randomUUID() },
    {
      now,
      makeId: () => crypto.randomUUID(),
    },
  );
}

function target({ siteId, id, version }: Booking) {
  return { siteId, bookingId: id, version };
}

function accepted(result: ReturnType<typeof apply>) {
  if (!result.ok) throw new Error(result.error);
  const booking = result.state.bookings.find(({ id }) => id === result.bookingId);
  if (booking === undefined) throw new Error("Missing changed booking");
  return { state: result.state, booking };
}

function create(
  state: BookingState,
  role: FixtureRole,
  siteId: string,
  time: BookingWindow,
  requested: BookingDemand,
) {
  const requesterId = fixtureBookingScope(state, user, role).viewer.id;
  return accepted(
    apply(state, role, {
      type: "saveBooking",
      siteId,
      bookingId: null,
      version: null,
      requesterId,
      title: "Functional test",
      description: null,
      window: time,
      lines: [requested],
    }),
  );
}

it("holds pending capacity, denies self approval, and releases it when returned for edits", () => {
  const { state, site, booking } = seed();
  const review = {
    ...target(booking),
    type: "reviewBooking",
    decision: "approve",
    reason: null,
  } as const;
  expect(apply(state, "base", review)).toEqual({ ok: false, error: "unavailable" });

  const model = state.resources.find(({ kind }) => kind === "model");
  if (model === undefined) throw new Error("Missing demo meter model");
  const second = create(state, "self_service", site.id, booking.window, {
    kind: "model",
    resourceId: model.resourceId,
    locationId: null,
    quantity: 2,
  });
  const requester = fixtureBookingScope(second.state, user, "self_service");
  const check = {
    siteId: site.id,
    bookingId: second.booking.id,
    window: booking.window,
    lines: [{ kind: "model", resourceId: model.resourceId, locationId: null, quantity: 2 }],
  } as const;
  expect(previewBookingAvailability(requester, { ...check, lines: [...check.lines] }, now)).toEqual(
    { ok: false, error: "capacity" },
  );
  expect(
    previewBookingAvailability(
      requester,
      { ...check, bookingId: booking.id, lines: [...check.lines] },
      now,
    ),
  ).toEqual({ ok: false, error: "unavailable" });
  expect(
    apply(second.state, "self_service", { ...target(second.booking), type: "submitBooking" }),
  ).toEqual({ ok: false, error: "capacity" });
  const reverted = accepted(
    apply(second.state, "manager", {
      ...review,
      decision: "request_changes",
      reason: "Confirm the pickup count",
    }),
  );
  expect(reverted.booking.status).toBe("draft");
  expect(reverted.booking.history[0]).toMatchObject({
    kind: "sent_back",
    actor: user.name,
    reason: "Confirm the pickup count",
  });
  const allowed = accepted(
    apply(reverted.state, "self_service", {
      ...target(second.booking),
      type: "submitBooking",
    }),
  );
  expect(allowed.booking.status).toBe("confirmed");
});

it("keeps another request private and requires renewed approval on expansion", () => {
  const { state, booking } = seed();
  const alternative = projectBookings(fixtureBookingScope(state, user, "self_service"));
  expect(alternative.bookings).toEqual([]);
  expect(alternative.calendar).toEqual([
    expect.objectContaining({ bookingId: null, title: null, kind: "pending" }),
  ]);
  expect(alternative.calendar[0]?.id).not.toBe(booking.id);
  const approved = accepted(
    apply(state, "manager", {
      ...target(booking),
      type: "reviewBooking",
      decision: "approve",
      reason: null,
    }),
  );
  expect(approved.booking.status).toBe("confirmed");
  const modified = accepted(
    apply(approved.state, "base", {
      ...target(approved.booking),
      type: "saveBooking",
      requesterId: booking.requesterId,
      title: booking.title,
      description: booking.description,
      window: {
        startAt: booking.window.startAt,
        endAt: new Date(Date.parse(booking.window.endAt) + 1_800_000).toISOString(),
      },
      lines: booking.lines.map(({ kind, resourceId, locationId, quantity }) => ({
        kind,
        resourceId,
        locationId,
        quantity,
      })),
    }),
  );
  expect(modified.booking.status).toBe("pending");
  expect(
    apply(modified.state, "manager", {
      ...target(approved.booking),
      type: "reviewBooking",
      decision: "approve",
      reason: null,
    }),
  ).toEqual({ ok: false, error: "stale" });
});

it("checks pickup and return in the facility zone, with closed-date overrides and skips", () => {
  const { site } = seed();
  const policy = { ...site.policy, maxDurationMinutes: 24 * 60, skipClosedDays: true };
  const weekend = siteWindow("2026-11-27", "16:00", "2026-11-30", "09:00");
  expect(validateBookingWindow(policy, weekend, "base", now)).toBeNull();
  expect(validateBookingWindow({ ...policy, skipClosedDays: false }, weekend, "base", now)).toBe(
    "duration",
  );
  expect(
    validateBookingWindow(
      {
        ...policy,
        workingHours: {
          ...policy.workingHours,
          overrides: [{ date: "2026-11-30", hours: null, reason: "Maintenance" }],
        },
      },
      weekend,
      "base",
      now,
    ),
  ).toBe("closed_hours");
  const tooEarly = siteWindow("2026-11-23", "08:15", "2026-11-23", "09:00");
  expect(validateBookingWindow(policy, tooEarly, "base", now)).toBe("insufficient_notice");
  expect(validateBookingWindow(policy, tooEarly, "manager", now)).toBeNull();
});
