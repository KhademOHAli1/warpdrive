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
  it("keeps the visible civil month across locale/calendar changes and follows an external value", async () => {
    const onChange = vi.fn();
    const draft = (locale: "en" | "fa", calendar: "gregory" | "persian", value = "2026-07-04") => (
      <LocaleProvider locale={locale} calendar={calendar}>
        <input aria-label="Draft title" defaultValue="" />
        <DatePicker value={value} onChange={onChange} ariaLabel="Start date" />
      </LocaleProvider>
    );
    const view = render(draft("en", "gregory"));
    fireEvent.change(screen.getByLabelText("Draft title"), { target: { value: "پیگیری قرارداد" } });
    fireEvent.click(screen.getByLabelText("Start date"));
    fireEvent.click(await screen.findByRole("button", { name: "Go to the Next Month" }));
    expect(screen.getByRole("grid")).toHaveAccessibleName("August 2026");

    view.rerender(draft("fa", "gregory"));
    expect(await screen.findByRole("grid", { name: "اوت ۲۰۲۶" })).toBeVisible();
    expect(screen.getByRole("button", { name: "شنبه، ۱۵ اوت ۲۰۲۶" })).toBeVisible();
    expect(screen.getByLabelText("Start date")).toHaveTextContent("۲۰۲۶/۰۷/۰۴");

    view.rerender(draft("fa", "persian"));
    expect(await screen.findByRole("grid", { name: "مرداد ۱۴۰۵" })).toBeVisible();
    expect(screen.getByRole("button", { name: "شنبه، ۲۴ مرداد ۱۴۰۵" })).toBeVisible();
    expect(screen.getByLabelText("Start date")).toHaveTextContent("۱۴۰۵/۰۴/۱۳");

    view.rerender(draft("fa", "persian", "2026-11-20"));
    expect(await screen.findByRole("grid", { name: "آبان ۱۴۰۵" })).toBeVisible();
    expect(screen.getByRole("button", { name: "جمعه، ۲۹ آبان ۱۴۰۵، انتخاب‌شده" })).toBeVisible();
    expect(screen.getByLabelText("Draft title")).toHaveValue("پیگیری قرارداد");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens at the account's Nowruz day and marks today when the browser is still on yesterday", async () => {
    vi.stubEnv("TZ", "Pacific/Honolulu");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-20T22:00:00Z"));
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="fa" timeZone="Asia/Tehran">
        <DatePicker value={null} onChange={onChange} ariaLabel="Start date" />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByLabelText("Start date"));
    expect(await screen.findByRole("grid", { name: "فروردین ۱۴۰۵" })).toBeVisible();
    expect(screen.getByRole("button", { name: "امروز، شنبه، ۱ فروردین ۱۴۰۵" })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("respects a saved Gregorian calendar while keeping Farsi labels", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="fa" calendar="gregory">
        <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Start date" />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Start date")).toHaveTextContent("۲۰۲۶/۰۳/۲۱");
    fireEvent.click(screen.getByLabelText("Start date"));
    const next = await screen.findByText("۲۲", { selector: "button" });
    expect(next).toHaveAccessibleName("یکشنبه، ۲۲ مارس ۲۰۲۶");
    fireEvent.click(next);
    expect(onChange).toHaveBeenCalledWith("2026-03-22");
  });

  it("respects a saved Solar Hijri calendar with English labels", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="en" calendar="persian">
        <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Start date" />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Start date")).toHaveTextContent("1405/01/01");
    fireEvent.click(screen.getByLabelText("Start date"));
    const next = await screen.findByText("2", { selector: "button" });
    expect(next).toHaveAccessibleName("Sunday, Farvardin 2nd, 1405");
    fireEvent.click(next);
    expect(onChange).toHaveBeenCalledWith("2026-03-22");
  });

  it("updates the preferred calendar without changing the stored date or an unsaved draft", async () => {
    const onChange = vi.fn();
    const draft = (calendar: "persian" | "gregory") => (
      <LocaleProvider locale="fa" calendar={calendar}>
        <input aria-label="Draft title" defaultValue="" />
        <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Start date" />
      </LocaleProvider>
    );
    const view = render(draft("persian"));
    fireEvent.change(screen.getByLabelText("Draft title"), { target: { value: "پیگیری قرارداد" } });
    view.rerender(draft("gregory"));
    expect(await screen.findByText("۲۰۲۶/۰۳/۲۱")).toBeVisible();
    expect(screen.getByLabelText("Draft title")).toHaveValue("پیگیری قرارداد");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses chosen English digits with Farsi labels and keeps Gregorian action dates", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="fa" numberingSystem="latn">
        <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Start date" />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Start date")).toHaveTextContent("1405/01/01");
    fireEvent.click(screen.getByLabelText("Start date"));
    const second = await screen.findByText("2", { selector: "button" });
    expect(second).toHaveAccessibleName("یکشنبه، 2 فروردین 1405");
    fireEvent.click(second);
    expect(onChange).toHaveBeenCalledWith("2026-03-22");
  });
  it("defaults to the Iranian calendar when the interface language is Farsi", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Start date" />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Start date")).toHaveTextContent("۱۴۰۵/۰۱/۰۱");
    fireEvent.click(screen.getByLabelText("Start date"));
    expect(await screen.findByText("۲", { selector: "button" })).toBeVisible();
    expect(screen.getByText("۱", { selector: "button" })).toHaveAccessibleName(
      "شنبه، ۱ فروردین ۱۴۰۵، انتخاب‌شده",
    );
    fireEvent.click(screen.getByRole("button", { name: "نمایش تقویم میلادی" }));
    expect(screen.getByLabelText("Start date")).toHaveTextContent("۲۰۲۶/۰۳/۲۱");
    expect(screen.getByRole("button", { name: "نمایش تقویم هجری شمسی" })).toBeVisible();
    expect(await screen.findByRole("button", { name: "رفتن به ماه بعد" })).toBeVisible();
    const march22 = await screen.findByText("۲۲", { selector: "button" });
    expect(march22).toHaveAccessibleName("یکشنبه، ۲۲ مارس ۲۰۲۶");
    fireEvent.click(march22);
    expect(onChange).toHaveBeenCalledWith("2026-03-22");
  });
  it("switches to the Iranian calendar and returns the selected Gregorian date", async () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-03-21" onChange={onChange} ariaLabel="Start date" />);
    fireEvent.click(screen.getByLabelText("Start date"));
    fireEvent.click(screen.getByRole("button", { name: "Use Solar Hijri calendar" }));
    expect(screen.getByLabelText("Start date")).toHaveTextContent("1405/01/01");
    expect(screen.getByRole("button", { name: "Use Gregorian calendar" })).toBeVisible();
    expect(await screen.findByRole("button", { name: "Go to the Next Month" })).toBeVisible();
    expect(document.querySelector(".rdp-weekday")).toHaveTextContent("Sa");
    const second = await screen.findByText("2", { selector: "button" });
    expect(second).toHaveAccessibleName("Sunday, Farvardin 2nd, 1405");
    fireEvent.click(second);
    expect(onChange).toHaveBeenCalledWith("2026-03-22");
  });

  it("shows MM/DD/YYYY for the current value", () => {
    render(<DatePicker value="2026-07-04" onChange={vi.fn()} ariaLabel="Start date" />);
    expect(screen.getByLabelText("Start date")).toHaveTextContent("07/04/2026");
  });

  it("emits YYYY-MM-DD when a day is picked", async () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-07-04" onChange={onChange} ariaLabel="Start date" />);
    fireEvent.click(screen.getByLabelText("Start date"));
    // v10's DayButton sets aria-label to the full formatted date ("PPPP", e.g.
    // "Wednesday, July 15th, 2026") for a11y, so the accessible *name* is not
    // "15"; the visible day-of-month is the button's text content instead.
    // findByText (not getByText): the calendar is a next/dynamic chunk that loads on open.
    fireEvent.click(await screen.findByText("15"));
    expect(onChange).toHaveBeenCalledWith("2026-07-15");
  });

  it("clears via the Clear control", () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-07-04" onChange={onChange} ariaLabel="Start date" />);
    fireEvent.click(screen.getByLabelText("Start date"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("allows navigating into a future year via the next-month control", async () => {
    // Regression for: captionLayout="dropdown" without startMonth/endMonth
    // caps react-day-picker v10's navigable range at Dec 31 of the current
    // year, so the next-month chevron silently no-ops there and future
    // years are unreachable. Starting from December of the current year and
    // clicking "next month" must land on January of next year.
    const currentYear = new Date().getFullYear();
    const onChange = vi.fn();
    render(
      <DatePicker value={`${currentYear}-12-01`} onChange={onChange} ariaLabel="Start date" />,
    );
    fireEvent.click(screen.getByLabelText("Start date"));
    // findByRole: the calendar (a next/dynamic chunk) loads on open; once awaited it is present.
    fireEvent.click(await screen.findByRole("button", { name: "Go to the Next Month" }));
    fireEvent.click(screen.getByText("15"));
    expect(onChange).toHaveBeenCalledWith(`${currentYear + 1}-01-15`);
  });

  it("renders a per-day accessory and its hint for the days that have one", async () => {
    render(
      <DatePicker
        value="2026-07-04"
        onChange={vi.fn()}
        ariaLabel="Start date"
        dayAccessory={(ymd) =>
          ymd === "2026-07-15"
            ? { indicator: <span data-testid="dot" />, hint: "3 activities" }
            : null
        }
      />,
    );
    fireEvent.click(screen.getByLabelText("Start date"));
    const decorated = (await screen.findByText("15")).closest("button");
    expect(decorated?.querySelector("[data-testid='dot']")).not.toBeNull();
    expect(decorated).toHaveAccessibleName(/3 activities/);
    const plain = screen.getByText("16").closest("button");
    expect(plain?.querySelector("[data-testid='dot']")).toBeNull();
  });

  it("reports open and close so a caller can drop state the calendar forgot", async () => {
    const onOpenChange = vi.fn();
    render(
      <DatePicker
        value="2026-07-04"
        onChange={vi.fn()}
        ariaLabel="Start date"
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Start date"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reports the visible month so a caller can load data for it", async () => {
    const onMonthChange = vi.fn();
    render(
      <DatePicker
        value="2026-07-04"
        onChange={vi.fn()}
        ariaLabel="Start date"
        onMonthChange={onMonthChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Start date"));
    fireEvent.click(await screen.findByRole("button", { name: "Go to the Next Month" }));
    expect(onMonthChange).toHaveBeenCalled();
    const month = onMonthChange.mock.calls[0]?.[0] as Date;
    expect(month.getMonth()).toBe(7);
    expect(month.getFullYear()).toBe(2026);
  });
});
