// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarEventOwnership } from "./CalendarEventOwnership";

afterEach(cleanup);
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
it.each([
  { locale: "fa", calendar: "تقویم رویداد" },
  { locale: "de", calendar: "Kalender des Termins" },
] as const)("offers only calendars the user can write in $locale", async ({ locale, calendar }) => {
  const onChange = vi.fn();
  render(
    <LocaleProvider locale={locale}>
      <CalendarEventOwnership
        settings={{ calendarId: "own", eventVisibility: "default", availability: "busy" }}
        calendars={[
          { id: "own", name: "Team", role: "owner" },
          { id: "write", name: "Projekt", role: "editor" },
          { id: "read", name: "Read only", role: "reader" },
        ]}
        legacy={false}
        onChange={onChange}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: `${calendar}: Team` }));
  fireEvent.pointerDown(screen.getByRole("combobox", { name: calendar }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  expect(screen.queryByRole("option", { name: "Read only" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("option", { name: "Projekt" }));
  expect(onChange).toHaveBeenCalledWith({ calendarId: "write" });
});
