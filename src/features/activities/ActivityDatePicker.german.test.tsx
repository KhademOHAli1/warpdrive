// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

const useQuery = vi.fn();
vi.mock("@/lib/trpc-client", () => ({
  trpc: { activities: { dayLoad: { useQuery: (...args: unknown[]) => useQuery(...args) } } },
}));

import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ActivityDatePicker } from "./ActivityDatePicker";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  useQuery.mockReset();
});

it("keeps German Gregorian/Iranian grids, ISO day-load bounds and the draft together", async () => {
  useQuery.mockReturnValue({ data: { counts: { "2026-08-15": 4, "2026-11-20": 4 }, target: 5 } });
  const onChange = vi.fn();
  const draft = (locale: "en" | "de", calendar: "gregory" | "persian", value = "2026-07-04") => (
    <LocaleProvider locale={locale} calendar={calendar} timeZone="Asia/Tehran">
      <input aria-label="Entwurf" defaultValue="" />
      <ActivityDatePicker value={value} onChange={onChange} ariaLabel="Datum" />
    </LocaleProvider>
  );
  const view = render(draft("en", "gregory"));
  fireEvent.change(screen.getByLabelText("Entwurf"), { target: { value: "Angebot nachfassen" } });
  fireEvent.click(screen.getByLabelText("Datum"));
  fireEvent.click(await screen.findByRole("button", { name: "Go to the Next Month" }));

  view.rerender(draft("de", "gregory"));

  expect(await screen.findByRole("grid")).toHaveAccessibleName("August 2026");
  expect(
    screen.getByRole("button", { name: /Samstag, 15. August 2026/ }).querySelector(".bg-amber-500"),
  ).not.toBeNull();
  let input = useQuery.mock.calls.at(-1)?.[0] as { from: string; to: string; timeZone: string };
  expect(input.timeZone).toBe("Asia/Tehran");
  expect(input.from < "2026-08-01").toBe(true);
  expect(input.to > "2026-08-31").toBe(true);
  expect(input.to < "2026-10-01").toBe(true);

  view.rerender(draft("de", "persian"));

  expect(await screen.findByRole("grid")).toHaveAccessibleName("Mordād 1405");
  expect(
    screen.getByRole("button", { name: /Samstag, 24. Mordād 1405/ }).querySelector(".bg-amber-500"),
  ).not.toBeNull();
  expect(screen.getByLabelText("Datum")).toHaveTextContent("13.04.1405");
  input = useQuery.mock.calls.at(-1)?.[0] as typeof input;
  expect(input.from < "2026-07-23").toBe(true);
  expect(input.to > "2026-08-22").toBe(true);
  expect(input.to < "2026-10-01").toBe(true);

  view.rerender(draft("de", "persian", "2026-11-20"));

  expect(await screen.findByRole("grid")).toHaveAccessibleName("Ābān 1405");
  expect(
    screen
      .getByRole("button", { name: /Freitag, 29. Ābān 1405, ausgewählt/ })
      .querySelector(".bg-amber-500"),
  ).not.toBeNull();
  input = useQuery.mock.calls.at(-1)?.[0] as typeof input;
  expect(input.from > "2026-10-01").toBe(true);
  expect(input.from < "2026-10-23").toBe(true);
  expect(input.to > "2026-11-21").toBe(true);
  expect(screen.getByLabelText("Entwurf")).toHaveValue("Angebot nachfassen");
  expect(onChange).not.toHaveBeenCalled();
});
