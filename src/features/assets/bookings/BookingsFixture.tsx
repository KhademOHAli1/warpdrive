"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { BookingAvailabilityInput, BookingCommand, BookingResult } from "./contracts";
import {
  createBookingFixture,
  createBookingHandoverDemo,
  type FixtureRole,
  fixtureBookingScope,
  fixtureHandoverBookingId,
} from "./fixtures";
import type { BookingHandoverAccess } from "./handover/contracts";
import { lookupFixtureEquipment } from "./handover/fixtureLookup";
import { createHandoverFixture, hasFixtureHandover } from "./handover/fixtureState";
import { fixtureHandoverCapacity } from "./handover/handoverCapacity";
import { projectFixtureHandover } from "./handover/projection";
import { applyFixtureHandover } from "./handover/transitions";
import {
  applyBookingCommand,
  type BookingState,
  previewBookingAvailability,
  projectBookings,
} from "./transitions";
import { BookingWorkspace } from "./ui/BookingWorkspace";

const previewRoles: FixtureRole[] = ["manager", "base", "self_service"];
const words = {
  en: {
    preview: "Demo role",
    handover: "Open handover demo",
    advance: "Advance demo clock past due",
    returnToBookings: "Back to booking demo",
    manager: "Manager",
    base: "Base requester",
    self_service: "Self-service",
  },
  de: {
    preview: "Demo-Rolle",
    handover: "Übergabe-Demo öffnen",
    advance: "Demo-Zeit über die Rückgabefrist stellen",
    returnToBookings: "Zur Buchungsdemo",
    manager: "Verwaltung",
    base: "Anfragende",
    self_service: "Selbstbedienung",
  },
  fa: {
    preview: "نقش نمایشی",
    handover: "باز کردن نمونه تحویل",
    advance: "بردن ساعت نمایشی به بعد از موعد",
    returnToBookings: "بازگشت به نمونه رزرو",
    manager: "مدیر",
    base: "درخواست‌کننده",
    self_service: "خودخدمت",
  },
} as const;

export function BookingsFixture({
  actorId,
  actorName,
  admin,
  initialNow,
  handoverDemo = false,
}: {
  actorId: string;
  actorName: string;
  admin: boolean;
  initialNow: string;
  handoverDemo?: boolean;
}) {
  const t = words[useLocale()];
  const principal = useMemo(() => ({ id: actorId, name: actorName }), [actorId, actorName]);
  const [role, setRole] = useState<FixtureRole>(admin ? "manager" : "base");
  const [initial] = useState(() => {
    if (!handoverDemo) {
      return {
        state: createBookingFixture(principal, admin, initialNow),
        handovers: null,
        clock: initialNow,
      };
    }
    const demo = createBookingHandoverDemo(principal, admin, initialNow);
    return { state: demo.state, handovers: createHandoverFixture(demo.assets), clock: demo.clock };
  });
  const state = useRef(initial.state);
  const handovers = useRef(initial.handovers);
  const [clock, setClock] = useState(initial.clock);
  const [view, setView] = useState(() => projectBookings(initial.state));
  const requests = useRef(new Map<string, { signature: string; bookingId: string | null }>());
  const scoped = useCallback(
    () => (admin ? fixtureBookingScope(state.current, principal, role) : state.current),
    [admin, principal, role],
  );

  const handover = useMemo<BookingHandoverAccess | undefined>(() => {
    if (!handoverDemo) return undefined;
    const unavailable = { ok: false, error: "unavailable" } as const;
    return {
      read: (bookingId) => {
        const current = handovers.current;
        return Promise.resolve(
          current === null
            ? unavailable
            : projectFixtureHandover(scoped(), current, bookingId, clock),
        );
      },
      submit: (command) => {
        const current = handovers.current;
        if (current === null) return Promise.resolve(unavailable);
        const result = applyFixtureHandover(scoped(), current, command, {
          now: clock,
          makeId: () => crypto.randomUUID(),
        });
        if (!result.ok) return Promise.resolve(result);
        state.current = result.state;
        handovers.current = result.handovers;
        return Promise.resolve({ ok: true, value: result.value, booking: result.booking });
      },
      lookup: (bookingId, code) => {
        const current = handovers.current;
        if (current === null) return Promise.resolve(unavailable);
        const scope = scoped();
        const booking = scope.bookings.find(({ id }) => id === bookingId);
        if (booking === undefined) return Promise.resolve(unavailable);
        const result = projectFixtureHandover(scope, current, bookingId, clock);
        if (!result.ok || !result.value.canOperate) return Promise.resolve(unavailable);
        return Promise.resolve(
          lookupFixtureEquipment(
            current.assets,
            booking.siteId,
            scope.viewer.id,
            window.location.origin,
            code,
          ),
        );
      },
    };
  }, [clock, handoverDemo, scoped]);

  function advanceClock() {
    const booking = state.current.bookings.find(({ id }) => id === fixtureHandoverBookingId);
    if (booking !== undefined) {
      setClock(
        new Date(
          Math.max(Date.parse(clock), Date.parse(booking.window.endAt) + 60_000),
        ).toISOString(),
      );
    }
  }

  function preview(next: FixtureRole) {
    setView(projectBookings(fixtureBookingScope(state.current, principal, next)));
    setRole(next);
  }

  function demoCapacity(bookings: BookingState) {
    const handoverState = handovers.current;
    return handoverState === null
      ? undefined
      : fixtureHandoverCapacity(bookings, handoverState, clock);
  }

  function checkAvailability(input: BookingAvailabilityInput) {
    const current = scoped();
    const now = handoverDemo ? clock : new Date().toISOString();
    return Promise.resolve(previewBookingAvailability(current, input, now, demoCapacity(current)));
  }

  function submit(command: BookingCommand): Promise<BookingResult> {
    const current = scoped();
    const key = `${current.viewer.id}:${command.requestId}`;
    const signature = JSON.stringify(command);
    const receipt = requests.current.get(key);
    if (receipt !== undefined) {
      return Promise.resolve(
        receipt.signature === signature
          ? { ok: true, value: projectBookings(current), bookingId: receipt.bookingId }
          : { ok: false, error: "conflict" },
      );
    }
    const handoverState = handovers.current;
    if (
      handoverState !== null &&
      "bookingId" in command &&
      command.bookingId !== null &&
      hasFixtureHandover(handoverState, command.bookingId)
    ) {
      if (command.type === "saveBooking" || command.type === "cancelBooking") {
        return Promise.resolve({ ok: false, error: "state" });
      }
      if (command.type === "archiveBooking" && command.archived) {
        const handover = projectFixtureHandover(current, handoverState, command.bookingId, clock);
        if (!handover.ok || handover.value.status !== "completed") {
          return Promise.resolve({ ok: false, error: "state" });
        }
      }
    }

    const result = applyBookingCommand(current, command, {
      now: handoverDemo ? clock : new Date().toISOString(),
      makeId: () => crypto.randomUUID(),
      capacity: demoCapacity(current),
    });
    if (!result.ok) return Promise.resolve(result);
    state.current = result.state;
    requests.current.set(key, { signature, bookingId: result.bookingId });
    return Promise.resolve({
      ok: true,
      value: projectBookings(result.state),
      bookingId: result.bookingId,
    });
  }

  return (
    <>
      {admin && (
        <fieldset className="mx-4 mt-4 flex flex-wrap items-center gap-2 sm:mx-6">
          <legend className="mb-1 text-sm text-muted-foreground">{t.preview}</legend>
          {previewRoles.map((next) => (
            <Button
              key={next}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={role === next}
              onClick={() => preview(next)}
            >
              {t[next]}
            </Button>
          ))}
          {handoverDemo ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={advanceClock}>
                {t.advance}
              </Button>
              <Link
                href="/assets/bookings"
                className={buttonVariants({ size: "sm", variant: "ghost" })}
              >
                {t.returnToBookings}
              </Link>
            </>
          ) : (
            <Link
              href="/assets/bookings?demo=handover"
              className={buttonVariants({ size: "sm", variant: "ghost" })}
            >
              {t.handover}
            </Link>
          )}
        </fieldset>
      )}
      <BookingWorkspace
        key={role}
        initial={view}
        handover={handover}
        submit={submit}
        checkAvailability={checkAvailability}
        fixture
      />
    </>
  );
}
