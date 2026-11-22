"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { BookingAvailabilityInput, BookingCommand, BookingResult } from "./contracts";
import { createBookingFixture, type FixtureRole, fixtureBookingScope } from "./fixtures";
import { applyBookingCommand, previewBookingAvailability, projectBookings } from "./transitions";
import { BookingWorkspace } from "./ui/BookingWorkspace";

const previewRoles: FixtureRole[] = ["manager", "base", "self_service"];
const words = {
  en: {
    preview: "Demo role",
    manager: "Manager",
    base: "Base requester",
    self_service: "Self-service",
  },
  de: {
    preview: "Demo-Rolle",
    manager: "Verwaltung",
    base: "Anfragende",
    self_service: "Selbstbedienung",
  },
  fa: { preview: "نقش نمایشی", manager: "مدیر", base: "درخواست‌کننده", self_service: "خودخدمت" },
} as const;

export function BookingsFixture({
  actorId,
  actorName,
  admin,
}: {
  actorId: string;
  actorName: string;
  admin: boolean;
}) {
  const t = words[useLocale()];
  const principal = { id: actorId, name: actorName };
  const [role, setRole] = useState<FixtureRole>(admin ? "manager" : "base");
  const [initial] = useState(() =>
    createBookingFixture(principal, admin, new Date().toISOString()),
  );
  const state = useRef(initial);
  const [view, setView] = useState(() => projectBookings(initial));
  const requests = useRef(new Map<string, { signature: string; bookingId: string | null }>());
  const scoped = () =>
    admin ? fixtureBookingScope(state.current, principal, role) : state.current;

  function preview(next: FixtureRole) {
    setView(projectBookings(fixtureBookingScope(state.current, principal, next)));
    setRole(next);
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
    const result = applyBookingCommand(current, command, {
      now: new Date().toISOString(),
      makeId: () => crypto.randomUUID(),
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
        </fieldset>
      )}
      <BookingWorkspace
        key={role}
        initial={view}
        submit={submit}
        checkAvailability={(input: BookingAvailabilityInput) =>
          Promise.resolve(previewBookingAvailability(scoped(), input, new Date().toISOString()))
        }
        fixture
      />
    </>
  );
}
