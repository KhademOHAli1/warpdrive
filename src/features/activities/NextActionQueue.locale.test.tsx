// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { NextActionQueue } from "./NextActionQueue";
import { activityRow, queueProps } from "./NextActionQueue.test-support";

afterEach(cleanup);
test.each([
  ["fa", "اقدام‌های بعدی", "فعالیت عقب‌افتاده", "ثبت انجام فعالیت"],
  ["de", "Nächste Schritte", "Überfällige Aktivität", "Als erledigt markieren"],
  ["en", "Next actions", "Overdue activity", "Mark complete"],
] as const)(
  "%s preserves authored mixed text with localized reasons and actions",
  (locale: Locale, title, reason, complete) => {
    render(
      <LocaleProvider locale={locale}>
        <NextActionQueue {...queueProps()} onCompleteActivity={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText(reason)).toBeVisible();
    expect(screen.getByText(complete).closest("button")).toBeVisible();
    expect(screen.getByText("پیگیری / Follow-up")).toBeVisible();
    expect(screen.getByText("پیشنهاد / Angebot")).toBeVisible();
    expect(screen.getByText("پیگیری / Follow-up").closest("bdi")).toHaveAttribute("dir", "auto");
  },
);

test("dates use the server account zone while keeping the selected locale and calendar", () => {
  const props = queueProps();
  const view = render(
    <LocaleProvider locale="en" calendar="persian" timeZone="America/New_York">
      <NextActionQueue {...props} />
    </LocaleProvider>,
  );
  const due = view.container.querySelector('time[datetime="2026-10-31T10:00:00Z"]');
  expect(due).toHaveTextContent("11:00 AM");
  expect(due).not.toHaveTextContent("6:00 AM");
  expect(due).not.toHaveTextContent("Oct");
  expect(due).toHaveAttribute("datetime", "2026-10-31T10:00:00Z");
});

test("all-day multi-day work displays its saved civil range", () => {
  const props = queueProps();
  const activity = {
    ...activityRow(),
    allDay: true,
    dueDate: "2026-10-29",
    endDate: "2026-10-31",
    endAt: "2026-10-31T23:00:00Z",
  };
  render(
    <LocaleProvider locale="en" calendar="gregory">
      <NextActionQueue {...props} page={{ ...props.page, rows: [activity] }} />
    </LocaleProvider>,
  );
  expect(screen.getByText("Oct 29 – Oct 31")).toBeVisible();
});
