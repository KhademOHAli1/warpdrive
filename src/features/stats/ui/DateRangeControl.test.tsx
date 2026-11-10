// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CalendarSystem } from "@/features/i18n/preferences";
import type { Locale } from "@/features/i18n/registry";

vi.mock("@/components/ui/DatePicker", () => ({
  DatePicker: ({
    ariaLabel,
    value,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    onChange: (value: string | null) => void;
  }) => (
    <input
      type="date"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    />
  ),
}));

import { DateRangeControl } from "./DateRangeControl";
import { presetRange } from "./dateRange";

type Range = { from: string; to: string };

function RangeHarness({
  today,
  initial,
  onChange,
}: {
  today: string;
  initial: Range;
  onChange: (range: Range) => void;
}) {
  const [range, setRange] = useState(initial);
  return (
    <DateRangeControl
      today={today}
      {...range}
      onChange={(next) => {
        setRange(next);
        onChange(next);
      }}
    />
  );
}

function mount({
  locale = "en",
  calendar = "gregory",
  today = "2026-03-20",
  initial,
}: {
  locale?: Locale;
  calendar?: CalendarSystem;
  today?: string;
  initial?: Range;
} = {}) {
  const changed = vi.fn();
  render(
    <LocaleProvider locale={locale} calendar={calendar}>
      <RangeHarness
        today={today}
        initial={initial ?? presetRange("year", today, calendar)}
        onChange={changed}
      />
    </LocaleProvider>,
  );
  return changed;
}

afterEach(cleanup);

describe("regional reporting preset controls", () => {
  it.each([
    ["en", "persian", "This month", "2026-02-20", "Iranian Solar Hijri"],
    ["de", "persian", "Dieser Monat", "2026-02-20", "iranischen Sonnenkalender"],
    ["fa", "gregory", "ماه جاری", "2026-03-01", "تقویم میلادی"],
    ["fa", "persian", "ماه جاری", "2026-02-20", "تقویم هجری خورشیدی"],
  ] as const)(
    "uses the selected %s/%s language-calendar pair independently",
    async (locale, calendar, monthLabel, from, basis) => {
      const changed = mount({ locale, calendar });
      await userEvent.click(screen.getByRole("button", { name: monthLabel }));
      expect(changed).toHaveBeenLastCalledWith({ from, to: "2026-03-20" });
      expect(screen.getByRole("button", { name: monthLabel })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByText(new RegExp(basis))).toBeInTheDocument();
    },
  );

  it("marks only the chosen preset when month, quarter and year coincide at Nowruz", async () => {
    const changed = mount({ calendar: "persian", today: "2026-03-21" });
    expect(screen.getByRole("button", { name: "This year" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "This month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: "This quarter" }));
    expect(changed).toHaveBeenLastCalledWith({ from: "2026-03-21", to: "2026-03-21" });
    expect(screen.getByRole("button", { name: "This quarter" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "This year" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("preserves manual reversed ranges for the dashboard validator and clears the preset state", () => {
    const changed = mount({ calendar: "persian", today: "2026-03-21" });
    fireEvent.change(screen.getByLabelText("Range start"), { target: { value: "2027-01-01" } });
    expect(changed).toHaveBeenLastCalledWith({ from: "2027-01-01", to: "2026-03-21" });
    expect(screen.getByLabelText("Range end")).toHaveValue("2026-03-21");
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("uses the selected calendar's year start when a date is cleared without claiming preset selection", () => {
    const changed = mount({
      calendar: "persian",
      initial: { from: "2026-02-20", to: "2026-03-15" },
    });
    fireEvent.change(screen.getByLabelText("Range start"), { target: { value: "" } });
    expect(changed).toHaveBeenLastCalledWith({ from: "2025-03-21", to: "2026-03-15" });
    fireEvent.change(screen.getByLabelText("Range end"), { target: { value: "" } });
    expect(changed).toHaveBeenLastCalledWith({ from: "2025-03-21", to: "2026-03-20" });
    expect(screen.getByRole("button", { name: "This year" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("preserves a custom range after a calendar preference change and applies the new calendar on selection", async () => {
    const changed = vi.fn();
    const control = (
      <RangeHarness
        today="2026-03-20"
        initial={{ from: "2026-02-01", to: "2026-03-15" }}
        onChange={changed}
      />
    );
    const view = render(
      <LocaleProvider locale="en" calendar="gregory">
        {control}
      </LocaleProvider>,
    );
    view.rerender(
      <LocaleProvider locale="en" calendar="persian">
        {control}
      </LocaleProvider>,
    );
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Range start")).toHaveValue("2026-02-01");
    expect(screen.getByLabelText("Range end")).toHaveValue("2026-03-15");
    expect(screen.getByText(/Iranian Solar Hijri/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "This month" }));
    expect(changed).toHaveBeenLastCalledWith({ from: "2026-02-20", to: "2026-03-20" });
  });

  it("associates calendar basis with the preset group and supports keyboard activation", async () => {
    const changed = mount({ calendar: "persian", today: "2026-03-21" });
    expect(screen.getByRole("group", { name: "Quick date ranges" })).toHaveAccessibleDescription(
      "Month, quarter and year presets follow the Iranian Solar Hijri calendar and end today.",
    );
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(changed).toHaveBeenLastCalledWith({ from: "2026-02-20", to: "2026-03-21" });
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
