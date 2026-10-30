// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { DatePicker } from "./DatePicker";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("German DatePicker", () => {
  it("defaults to German Gregorian dates and localizes controls, weekdays and selected days", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="de">
        <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Datum" />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Datum")).toHaveTextContent("21.03.2026");
    fireEvent.click(screen.getByLabelText("Datum"));
    expect(await screen.findByRole("grid")).toHaveAccessibleName("März 2026");
    expect(screen.getByRole("combobox", { name: "Monat auswählen" })).toHaveDisplayValue("März");
    expect(screen.getByRole("combobox", { name: "Jahr auswählen" })).toHaveDisplayValue("2026");
    expect(screen.getByRole("button", { name: "Zum nächsten Monat" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Zum vorherigen Monat" })).toBeVisible();
    // DayPicker hides the weekday header from AX because each day button names its weekday.
    expect(document.querySelector(".rdp-weekday")).toHaveAttribute("aria-label", "Montag");
    expect(document.querySelector(".rdp-weekday")).toHaveTextContent("Mo");
    expect(
      screen.getByRole("button", { name: "Samstag, 21. März 2026, ausgewählt" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Sonntag, 22. März 2026" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-03-22");
  });

  it("uses German Iranian month/day labels and returns a Gregorian ISO date", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="de" calendar="persian">
        <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Datum" />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Datum")).toHaveTextContent("01.01.1405");
    fireEvent.click(screen.getByLabelText("Datum"));
    expect(await screen.findByRole("grid")).toHaveAccessibleName("Farwardin 1405");
    expect(screen.getByRole("combobox", { name: "Monat auswählen" })).toHaveDisplayValue(
      "Farwardin",
    );
    expect(screen.getByRole("combobox", { name: "Jahr auswählen" })).toHaveDisplayValue("1405");
    expect(screen.getByRole("button", { name: "Zum nächsten Monat" })).toBeVisible();
    expect(document.querySelector(".rdp-weekday")).toHaveAttribute("aria-label", "Samstag");
    expect(document.querySelector(".rdp-weekday")).toHaveTextContent("Sa");
    expect(
      screen.getByRole("button", { name: "Samstag, 1. Farwardin 1405, ausgewählt" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Sonntag, 2. Farwardin 1405" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-03-22");
  });

  it("navigates Iranian years and months through German dropdowns before selecting an ISO day", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="de" calendar="persian">
        <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Datum" />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByLabelText("Datum"));
    await screen.findByRole("grid");
    fireEvent.change(screen.getByRole("combobox", { name: "Jahr auswählen" }), {
      target: { value: "1406" },
    });
    expect(screen.getByRole("grid")).toHaveAccessibleName("Farwardin 1406");
    fireEvent.change(screen.getByRole("combobox", { name: "Monat auswählen" }), {
      target: { value: "1" },
    });
    expect(screen.getByRole("grid")).toHaveAccessibleName("Ordibehescht 1406");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Donnerstag, 2. Ordibehescht 1406" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("2027-04-22");
  });

  it("keeps navigation and an unsaved draft when switching calendars, then follows an external ISO value", async () => {
    const onChange = vi.fn();
    const draft = (value: string) => (
      <LocaleProvider locale="de" calendar="gregory">
        <input aria-label="Entwurf" defaultValue="" />
        <DatePicker value={value} onChange={onChange} ariaLabel="Datum" />
      </LocaleProvider>
    );
    const view = render(draft("2026-07-04"));
    fireEvent.change(screen.getByLabelText("Entwurf"), { target: { value: "Vertrag nachfassen" } });
    fireEvent.click(screen.getByLabelText("Datum"));
    expect(await screen.findByRole("grid")).toHaveAccessibleName("Juli 2026");
    fireEvent.click(screen.getByRole("button", { name: "Zum nächsten Monat" }));
    expect(screen.getByRole("grid")).toHaveAccessibleName("August 2026");
    fireEvent.click(screen.getByRole("button", { name: "Persischen Kalender verwenden" }));
    expect(await screen.findByRole("grid")).toHaveAccessibleName("Mordād 1405");
    expect(screen.getByLabelText("Datum")).toHaveTextContent("13.04.1405");
    expect(screen.getByRole("button", { name: "Samstag, 24. Mordād 1405" })).toBeVisible();

    view.rerender(draft("2026-11-20"));

    expect(await screen.findByRole("grid")).toHaveAccessibleName("Ābān 1405");
    expect(
      screen.getByRole("button", { name: "Freitag, 29. Ābān 1405, ausgewählt" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Datum")).toHaveTextContent("29.08.1405");
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Vertrag nachfassen");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the account's Iranian today with German labels and Latin digits despite a saved Persian digit preference", async () => {
    vi.stubEnv("TZ", "Pacific/Honolulu");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-20T22:00:00Z"));
    const onChange = vi.fn();
    render(
      <LocaleProvider
        locale="de"
        calendar="persian"
        timeZone="Asia/Tehran"
        numberingSystem="arabext"
      >
        <DatePicker value={null} onChange={onChange} ariaLabel="Datum" />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByLabelText("Datum"));
    expect(await screen.findByRole("grid")).toHaveAccessibleName("Farwardin 1405");
    const today = screen.getByRole("button", { name: "Heute, Samstag, 1. Farwardin 1405" });
    expect(today).toHaveTextContent("1");
    fireEvent.click(today);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-03-21");
  });
});
