// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { LocalePreferences } from "@/features/i18n/preferences";
import { ComposerFooter } from "./ComposerFooter";

beforeEach(() => {
  vi.stubEnv("TZ", "UTC");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-03-20T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function footer(preferences: LocalePreferences, onSendLater: (at: Date) => void) {
  return (
    <LocaleProvider {...preferences}>
      <ComposerFooter
        canSend
        sending={false}
        onSend={vi.fn()}
        onDiscard={vi.fn()}
        trackOpens={false}
        onTrackOpensChange={vi.fn()}
        trackLinks={false}
        onTrackLinksChange={vi.fn()}
        onSendLater={onSendLater}
      />
    </LocaleProvider>
  );
}

function openSchedule(preferences: LocalePreferences) {
  const onSendLater = vi.fn();
  const view = render(footer(preferences, onSendLater));
  fireEvent.click(
    screen.getByRole("button", {
      name: preferences.locale === "fa" ? "ارسال در زمان دیگر" : "Send later",
    }),
  );
  return {
    onSendLater,
    updatePreferences: (next: LocalePreferences) => view.rerender(footer(next, onSendLater)),
  };
}

function enterTime(label: string, value: string): void {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

it("uses English Solar Hijri controls and the Tehran account zone with a UTC browser", async () => {
  const { onSendLater } = openSchedule({
    locale: "en",
    calendar: "persian",
    timeZone: "Asia/Tehran",
  });
  expect(new Date().getTimezoneOffset()).toBe(0);
  expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  fireEvent.click(screen.getByLabelText("Send date"));
  fireEvent.click(await screen.findByRole("button", { name: "Go to the Next Month" }));
  fireEvent.click(await screen.findByRole("button", { name: "Sunday, Farvardin 1st, 1406" }));
  enterTime("Send time", "09:00");
  expect(screen.getByText(/Asia\/Tehran/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(onSendLater).toHaveBeenCalledTimes(1);
  expect(onSendLater.mock.calls[0]?.[0]).toEqual(new Date("2027-03-21T05:30:00Z"));
});

it("keeps Farsi Gregorian dates and Persian time digits in the account zone", async () => {
  const { onSendLater } = openSchedule({
    locale: "fa",
    calendar: "gregory",
    timeZone: "Asia/Tehran",
  });
  fireEvent.click(screen.getByLabelText("تاریخ ارسال"));
  fireEvent.click(await screen.findByRole("button", { name: "یکشنبه، ۲۱ مارس ۲۰۲۷" }));
  enterTime("زمان ارسال", "۰۹:۰۰");
  fireEvent.click(screen.getByRole("button", { name: "زمان‌بندی" }));
  expect(onSendLater).toHaveBeenCalledTimes(1);
  expect(onSendLater.mock.calls[0]?.[0]).toEqual(new Date("2027-03-21T05:30:00Z"));
});

it("explains a skipped local send time in Farsi and preserves the selected fields", async () => {
  vi.setSystemTime(new Date("2027-03-13T12:00:00Z"));
  const { onSendLater } = openSchedule({
    locale: "fa",
    calendar: "gregory",
    timeZone: "America/New_York",
  });
  fireEvent.click(screen.getByLabelText("تاریخ ارسال"));
  fireEvent.click(await screen.findByRole("button", { name: "یکشنبه، ۱۴ مارس ۲۰۲۷" }));
  enterTime("زمان ارسال", "۰۲:۳۰");
  fireEvent.click(screen.getByRole("button", { name: "زمان‌بندی" }));
  expect(screen.getByRole("alert")).toHaveTextContent("این ساعت به‌دلیل تغییر ساعت رسمی وجود ندارد");
  expect(screen.getByLabelText("زمان ارسال")).toHaveValue("۰۲:۳۰");
  expect(onSendLater).not.toHaveBeenCalled();
});

it("shows which occurrence is used when a send time repeats at the end of DST", async () => {
  vi.setSystemTime(new Date("2027-11-06T12:00:00Z"));
  const { onSendLater } = openSchedule({
    locale: "en",
    calendar: "gregory",
    timeZone: "America/New_York",
  });
  fireEvent.click(screen.getByLabelText("Send date"));
  fireEvent.click(await screen.findByRole("button", { name: "Sunday, November 7th, 2027" }));
  enterTime("Send time", "01:30");
  expect(screen.getByText(/earlier occurrence/)).toHaveTextContent("UTC-04:00");
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(onSendLater.mock.calls[0]?.[0]).toEqual(new Date("2027-11-07T05:30:00Z"));
});

it("requires a complete schedule in Farsi without submitting an email", () => {
  const { onSendLater } = openSchedule({
    locale: "fa",
    calendar: "persian",
    timeZone: "Asia/Tehran",
  });
  fireEvent.click(screen.getByRole("button", { name: "زمان‌بندی" }));
  expect(screen.getByRole("alert")).toHaveTextContent("تاریخ و ساعت ارسال را انتخاب کنید");
  expect(onSendLater).not.toHaveBeenCalled();
});

it("keeps an authored send time in its original account zone when preferences change", async () => {
  const preferences = { locale: "en", calendar: "gregory", timeZone: "Asia/Tehran" } as const;
  const { onSendLater, updatePreferences } = openSchedule(preferences);
  fireEvent.click(screen.getByLabelText("Send date"));
  fireEvent.click(await screen.findByRole("button", { name: "Sunday, March 21st, 2027" }));
  enterTime("Send time", "09:00");
  updatePreferences({ ...preferences, timeZone: "America/New_York" });
  expect(screen.getByText(/Send time zone:.*Asia\/Tehran/)).toBeInTheDocument();
  expect(screen.getByLabelText("Send time")).toHaveValue("09:00");
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(onSendLater.mock.calls[0]?.[0]).toEqual(new Date("2027-03-21T05:30:00Z"));
});

it("starts on the account's civil date when the browser has not reached that date", () => {
  vi.setSystemTime(new Date("2027-03-20T22:00:00Z"));
  openSchedule({ locale: "en", calendar: "persian", timeZone: "Asia/Tehran" });
  expect(screen.getByLabelText("Send date")).toHaveTextContent("1406/01/01");
});

it("does not schedule a stale canonical time while an invalid raw time is shown", async () => {
  const { onSendLater } = openSchedule({ locale: "en", calendar: "gregory", timeZone: "UTC" });
  fireEvent.click(screen.getByLabelText("Send date"));
  fireEvent.click(await screen.findByRole("button", { name: "Sunday, March 21st, 2027" }));
  enterTime("Send time", "09:00");
  fireEvent.change(screen.getByLabelText("Send time"), { target: { value: "99:99" } });
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(onSendLater).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Send time")).toHaveValue("99:99");
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid time");
  enterTime("Send time", "10:00");
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(onSendLater).toHaveBeenCalledTimes(1);
  expect(onSendLater.mock.calls[0]?.[0]).toEqual(new Date("2027-03-21T10:00:00Z"));
});
