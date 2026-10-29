// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function loaded(counts: Record<string, number>, target = 5): void {
  useQuery.mockReturnValue({ data: { counts, target } });
}

async function openOn(value: string): Promise<void> {
  render(<ActivityDatePicker value={value} onChange={vi.fn()} ariaLabel="Start date" />);
  fireEvent.click(screen.getByLabelText("Start date"));
  await screen.findByText("15");
}

function dayButton(dayOfMonth: string): HTMLElement | null {
  return screen.getByText(dayOfMonth).closest("button");
}

it("keeps its rendered month and load bounds together through locale, calendar and value changes", async () => {
  loaded({ "2026-08-15": 4, "2026-11-20": 4 });
  const onChange = vi.fn();
  const draft = (locale: "en" | "fa", calendar: "gregory" | "persian", value = "2026-07-04") => (
    <LocaleProvider locale={locale} calendar={calendar} timeZone="Asia/Tehran">
      <input aria-label="Draft title" defaultValue="" />
      <ActivityDatePicker value={value} onChange={onChange} ariaLabel="Start date" />
    </LocaleProvider>
  );
  const view = render(draft("en", "gregory"));
  fireEvent.change(screen.getByLabelText("Draft title"), { target: { value: "تماس با مشتری" } });
  fireEvent.click(screen.getByLabelText("Start date"));
  fireEvent.click(await screen.findByRole("button", { name: "Go to the Next Month" }));
  expect(screen.getByRole("grid")).toHaveAccessibleName("August 2026");

  view.rerender(draft("fa", "gregory"));
  expect(await screen.findByRole("grid", { name: "اوت ۲۰۲۶" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: /شنبه، ۱۵ اوت ۲۰۲۶/ }).querySelector(".bg-amber-500"),
  ).not.toBeNull();
  let input = useQuery.mock.calls.at(-1)?.[0] as { from: string; to: string; timeZone: string };
  expect(input.timeZone).toBe("Asia/Tehran");
  expect(input.from < "2026-08-01").toBe(true);
  expect(input.to > "2026-08-31").toBe(true);
  expect(input.to < "2026-10-01").toBe(true);

  view.rerender(draft("fa", "persian"));
  expect(await screen.findByRole("grid", { name: "مرداد ۱۴۰۵" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: /شنبه، ۲۴ مرداد ۱۴۰۵/ }).querySelector(".bg-amber-500"),
  ).not.toBeNull();
  input = useQuery.mock.calls.at(-1)?.[0] as typeof input;
  expect(input.from < "2026-07-23").toBe(true);
  expect(input.to > "2026-08-22").toBe(true);
  expect(input.to < "2026-10-01").toBe(true);

  view.rerender(draft("fa", "persian", "2026-11-20"));
  expect(await screen.findByRole("grid", { name: "آبان ۱۴۰۵" })).toBeVisible();
  expect(
    screen
      .getByRole("button", { name: /جمعه، ۲۹ آبان ۱۴۰۵، انتخاب‌شده/ })
      .querySelector(".bg-amber-500"),
  ).not.toBeNull();
  input = useQuery.mock.calls.at(-1)?.[0] as typeof input;
  expect(input.from > "2026-10-01").toBe(true);
  expect(input.from < "2026-10-23").toBe(true);
  expect(input.to > "2026-11-21").toBe(true);
  expect(screen.getByLabelText("Draft title")).toHaveValue("تماس با مشتری");
  expect(onChange).not.toHaveBeenCalled();
});

it("uses the same account-local today for an empty picker and its day-load month", async () => {
  vi.stubEnv("TZ", "Pacific/Honolulu");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-20T22:00:00Z"));
  loaded({ "2026-03-21": 4 });
  render(
    <LocaleProvider locale="fa" timeZone="Asia/Tehran">
      <ActivityDatePicker value={null} onChange={vi.fn()} ariaLabel="Start date" />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByLabelText("Start date"));
  expect(await screen.findByRole("grid", { name: "فروردین ۱۴۰۵" })).toBeVisible();
  expect(
    screen
      .getByRole("button", { name: /امروز، شنبه، ۱ فروردین ۱۴۰۵/ })
      .querySelector(".bg-amber-500"),
  ).not.toBeNull();
  const [input] = useQuery.mock.calls.at(-1) as [{ from: string; to: string }];
  expect(input.from < "2026-03-21").toBe(true);
  expect(input.to > "2026-04-20").toBe(true);
});

it("colors each day by how full it is against the target", async () => {
  loaded({ "2026-07-14": 2, "2026-07-15": 4, "2026-07-16": 6 });
  await openOn("2026-07-04");
  expect(dayButton("14")?.querySelector(".bg-emerald-500")).not.toBeNull();
  expect(dayButton("15")?.querySelector(".bg-amber-500")).not.toBeNull();
  expect(dayButton("16")?.querySelector(".bg-red-500")).not.toBeNull();
});

it("leaves an empty day undecorated", async () => {
  loaded({ "2026-07-15": 4 });
  await openOn("2026-07-04");
  expect(dayButton("17")?.querySelector("span[class*='bg-']")).toBeNull();
});

it("names the exact count and target on a loaded day", async () => {
  loaded({ "2026-07-15": 1 });
  await openOn("2026-07-04");
  expect(dayButton("15")).toHaveAccessibleName(/1 activity scheduled, daily target 5/);
});

it("asks the server to bucket days in the account timezone independently of the browser", () => {
  loaded({});
  render(
    <LocaleProvider timeZone="Asia/Tehran">
      <ActivityDatePicker value="2026-07-04" onChange={vi.fn()} ariaLabel="Start date" />
    </LocaleProvider>,
  );
  const [input] = useQuery.mock.calls[0] as [{ timeZone: string }];
  expect(input.timeZone).toBe("Asia/Tehran");
});

it("pads the range past the grid so a local day is never half-covered", () => {
  loaded({});
  render(<ActivityDatePicker value="2026-07-04" onChange={vi.fn()} ariaLabel="Start date" />);
  const [input] = useQuery.mock.calls[0] as [{ from: string; to: string }];
  expect(input.from < "2026-06-29").toBe(true);
  expect(input.to > "2026-08-09").toBe(true);
});

it("loads the whole Solar Hijri month when switching calendars", () => {
  loaded({});
  render(<ActivityDatePicker value="2026-03-21" onChange={vi.fn()} ariaLabel="Start date" />);
  fireEvent.click(screen.getByLabelText("Start date"));
  fireEvent.click(screen.getByRole("button", { name: "Use Solar Hijri calendar" }));
  const [input] = useQuery.mock.calls.at(-1) as [{ from: string; to: string }];
  expect(input.from < "2026-03-01").toBe(true);
  expect(input.to > "2026-04-21").toBe(true);
});

it("keeps the navigated civil month when toggling the open calendar in Farsi", async () => {
  loaded({ "2026-08-15": 4 });
  const onChange = vi.fn();
  render(
    <LocaleProvider locale="fa" calendar="gregory" timeZone="Asia/Tehran">
      <ActivityDatePicker value="2026-07-04" onChange={onChange} ariaLabel="Start date" />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByLabelText("Start date"));
  fireEvent.click(await screen.findByRole("button", { name: "رفتن به ماه بعد" }));
  expect(screen.getByRole("grid")).toHaveAccessibleName("اوت ۲۰۲۶");
  fireEvent.click(screen.getByRole("button", { name: "نمایش تقویم هجری شمسی" }));
  expect(await screen.findByRole("grid", { name: "مرداد ۱۴۰۵" })).toBeVisible();
  expect(screen.getByRole("button", { name: /شنبه، ۲۴ مرداد ۱۴۰۵/ })).toBeVisible();
  const [input] = useQuery.mock.calls.at(-1) as [{ from: string; to: string }];
  expect(input.from > "2026-06-01").toBe(true);
  expect(input.to > "2026-08-22").toBe(true);
  expect(screen.getByLabelText("Start date")).toHaveTextContent("۱۴۰۵/۰۴/۱۳");
  fireEvent.click(screen.getByRole("button", { name: "نمایش تقویم میلادی" }));
  expect(await screen.findByRole("grid", { name: "اوت ۲۰۲۶" })).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
});

it("queries the month the calendar shows, not the UTC month of its local first day", () => {
  loaded({});
  render(<ActivityDatePicker value="2026-08-01" onChange={vi.fn()} ariaLabel="Start date" />);
  const [input] = useQuery.mock.calls[0] as [{ from: string; to: string }];
  expect(input.to > "2026-08-31").toBe(true);
});

it("drops a remembered month once the calendar is closed and reopened", async () => {
  loaded({});
  render(<ActivityDatePicker value="2026-07-04" onChange={vi.fn()} ariaLabel="Start date" />);
  fireEvent.click(screen.getByLabelText("Start date"));
  fireEvent.click(await screen.findByRole("button", { name: "Go to the Next Month" }));
  const navigatedInput = useQuery.mock.calls.at(-1) as [{ from: string }];
  expect(navigatedInput[0].from > "2026-07-15").toBe(true);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => {
    const latest = useQuery.mock.calls.at(-1) as [{ from: string }];
    expect(latest[0].from < "2026-07-01").toBe(true);
  });
});

it("follows the value into another month instead of holding the first month's counts", () => {
  loaded({});
  const { rerender } = render(
    <ActivityDatePicker value="2026-07-04" onChange={vi.fn()} ariaLabel="Start date" />,
  );
  rerender(<ActivityDatePicker value="2026-11-20" onChange={vi.fn()} ariaLabel="Start date" />);
  const last = useQuery.mock.calls.at(-1) as [{ from: string; to: string }];
  expect(last[0].from > "2026-10-01").toBe(true);
  expect(last[0].to > "2026-11-20").toBe(true);
});

it("asks for the visible month's range, scoped to the assignee", () => {
  loaded({});
  render(
    <ActivityDatePicker
      value="2026-07-04"
      onChange={vi.fn()}
      ariaLabel="Start date"
      assigneeId="11111111-1111-1111-1111-111111111111"
    />,
  );
  const [input] = useQuery.mock.calls[0] as [{ userId: string | null; from: string; to: string }];
  expect(input.userId).toBe("11111111-1111-1111-1111-111111111111");
  expect(input.from < "2026-07-01").toBe(true);
  expect(input.to > "2026-07-31").toBe(true);
});

it("reloads for the new month after the user navigates", async () => {
  loaded({});
  render(<ActivityDatePicker value="2026-07-04" onChange={vi.fn()} ariaLabel="Start date" />);
  fireEvent.click(screen.getByLabelText("Start date"));
  fireEvent.click(await screen.findByRole("button", { name: "Go to the Next Month" }));
  const last = useQuery.mock.calls.at(-1) as [{ from: string; to: string }];
  expect(last[0].from > "2026-07-15").toBe(true);
});

it("renders no dots while the counts are still loading", async () => {
  useQuery.mockReturnValue({ data: undefined });
  await openOn("2026-07-04");
  expect(dayButton("15")?.querySelector("span[class*='bg-']")).toBeNull();
});
