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

// vitest.config.ts sets globals: false, so @testing-library/react's auto
// cleanup (which checks for a global `afterEach`) never registers; without
// this, renders from earlier `it` blocks accumulate in the same jsdom document.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("DatePicker", () => {
  it("preserves a caller-supplied label while localizing only the picker display", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="en" calendar="gregory" numberingSystem="arabext">
        <DatePicker
          value="2026-03-21"
          onChange={onChange}
          ariaLabel="Start date"
          formatLabel={(value) => `Due C01234 / ${value}`}
        />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Start date")).toHaveTextContent("Due C01234 / 2026-03-21");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Start date"));
    const next = await screen.findByText("۲۲", { selector: "button" });
    fireEvent.click(next);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-03-22");
  });

  it.each([
    {
      calendar: "gregory",
      trigger: "۰۳/۲۱/۲۰۲۶",
      caption: "March ۲۰۲۶",
      year: "۲۰۲۶",
      rawYear: "2026",
      day: "۲۲",
      accessible: /Sunday, March ۲۲nd, ۲۰۲۶/,
    },
    {
      calendar: "persian",
      trigger: "۱۴۰۵/۰۱/۰۱",
      caption: "Farvardin ۱۴۰۵",
      year: "۱۴۰۵",
      rawYear: "1405",
      day: "۲",
      accessible: /Sunday, Farvardin ۲nd, ۱۴۰۵/,
    },
  ] as const)(
    "uses explicit Persian digits with English $calendar labels and canonical callbacks",
    async ({ calendar, trigger, caption, year, rawYear, day, accessible }) => {
      const onChange = vi.fn();
      render(
        <LocaleProvider
          locale="en"
          calendar={calendar}
          numberingSystem="arabext"
          timeZone="Asia/Tehran"
        >
          <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Start date" />
        </LocaleProvider>,
      );
      expect(screen.getByLabelText("Start date")).toHaveTextContent(trigger);
      fireEvent.click(screen.getByLabelText("Start date"));
      expect(await screen.findByRole("grid")).toHaveAccessibleName(caption);
      const yearChoice = screen.getByRole("combobox", { name: "Choose the Year" });
      expect(yearChoice).toHaveDisplayValue(year);
      expect(yearChoice).toHaveValue(rawYear);
      const next = screen.getByText(day, { selector: "button" });
      expect(next).toHaveAccessibleName(accessible);
      expect(next).not.toHaveAccessibleName(/[0-9]/);
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.click(next);
      expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-03-22");
    },
  );
});
