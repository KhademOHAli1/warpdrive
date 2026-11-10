// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarConnectionCard } from "./CalendarConnectionCard";
import {
  accountId,
  api,
  commitSelection,
  deferred,
  entryId,
  entryName,
  patchAccount,
  patchEntry,
  receipt,
  resetUi,
  ui,
} from "./calendarCatalogUiFixture";

vi.mock("next/navigation", async () => {
  const { api } = await import("./calendarCatalogUiFixture");
  return {
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ refresh: api.routerRefresh }),
  };
});
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "catalog-csrf" }));
vi.mock("./calendarCatalogActions", async () => {
  const { api } = await import("./calendarCatalogUiFixture");
  return {
    discoverGoogleCalendarsAction: api.discover,
    setGoogleCalendarSelectionAction: api.select,
  };
});
vi.mock("./connectionActions", async () => {
  const { api } = await import("./calendarCatalogUiFixture");
  return { disconnectGoogleCalendarAction: api.disconnect };
});
vi.mock("@/lib/trpc-client", async () => {
  const { api, queryCatalog, ui } = await import("./calendarCatalogUiFixture");
  return {
    trpc: {
      calendars: {
        googleAccounts: {
          useQuery: () => ({
            data: { configured: ui.configured, accounts: ui.accounts },
            isError: false,
            refetch: api.refetchAccounts,
          }),
        },
        googleCatalog: { useQuery: queryCatalog },
      },
      useUtils: () => ({
        calendars: {
          googleCatalog: { invalidate: api.invalidate },
          googleAccounts: { invalidate: api.invalidate },
        },
      }),
    },
  };
});
beforeEach(() => {
  vi.resetAllMocks();
  resetUi();
});
afterEach(cleanup);
function surface(locale: "en" | "fa" | "de" = "en") {
  return (
    <LocaleProvider locale={locale}>
      <CalendarConnectionCard />
    </LocaleProvider>
  );
}
function open() {
  const view = render(surface());
  fireEvent.click(screen.getByRole("button", { name: "Account calendars" }));
  return view;
}
function expectConnectionsLocked(): void {
  for (const name of [
    "Connect Google Calendar",
    "Reconnect owner@example.invalid",
    "Disconnect owner@example.invalid",
  ])
    expect(screen.getByRole("button", { name })).toBeDisabled();
}
const addName = `Add ${entryName}`;
const removeName = `Remove ${entryName}`;

it.each([
  { locale: "fa", title: "تقویم‌های حساب", refresh: "دریافت تقویم‌ها" },
  { locale: "de", title: "Kalender dieses Kontos", refresh: "Kalender abrufen" },
] as const)(
  "opens the inline account catalog in $locale without provider discovery",
  ({ locale, title, refresh }) => {
    render(surface(locale));
    const trigger = screen.getByRole("button", { name: title });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: refresh })).toBeInTheDocument();
    expect(api.discover).not.toHaveBeenCalled();
  },
);
it("enables only persisted reads after opening and never auto-discovers", () => {
  render(surface());
  expect(screen.getByRole("button", { name: "Account calendars" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(ui.reads.filter((read) => read.enabled)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Account calendars" }));
  expect(ui.reads.some((read) => read.enabled && read.accountId === accountId)).toBe(true);
  expect(api.discover).not.toHaveBeenCalled();
});
it("explicitly refreshes once and locks connection and other catalog actions while pending", async () => {
  const pending = deferred<{ ok: true; data: typeof ui.catalog }>();
  api.discover.mockReturnValue(pending.promise);
  open();
  const refresh = screen.getByRole("button", { name: "Fetch calendars" });
  fireEvent.click(refresh);
  try {
    await waitFor(() => expect(api.discover).toHaveBeenCalledWith({ accountId }, "catalog-csrf"));
    expectConnectionsLocked();
    expect(refresh).toBeDisabled();
    expect(screen.getByRole("button", { name: addName })).toBeDisabled();
    fireEvent.click(refresh);
    expect(api.discover).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => Promise.resolve(pending.resolve({ ok: true, data: ui.catalog })));
  }
});
it("retains the saved list when an explicit refresh fails", async () => {
  api.discover.mockResolvedValue({ ok: false, error: { id: ERROR_IDS.CALENDAR_CATALOG_FAILED } });
  open();
  fireEvent.click(screen.getByRole("button", { name: "Fetch calendars" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The calendar list could not be refreshed. The saved list is still shown.",
  );
  expect(screen.getByText(entryName)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: addName })).toBeDisabled();
});
it("adds the exact catalog identity/revision only after commit and keeps sync and Meet unavailable", async () => {
  const pending = deferred<ReturnType<typeof commitSelection>>();
  api.select.mockReturnValue(pending.promise);
  open();
  fireEvent.click(screen.getByRole("button", { name: addName }));
  try {
    await waitFor(() =>
      expect(api.select).toHaveBeenCalledWith(
        {
          accountId,
          calendarId: entryId,
          selected: true,
          expectedCatalogRevision: 7,
          expectedBindingVersion: null,
        },
        "catalog-csrf",
      ),
    );
    expect(screen.queryByRole("button", { name: removeName })).not.toBeInTheDocument();
    expectConnectionsLocked();
    expect(screen.getByRole("button", { name: "Fetch calendars" })).toBeDisabled();
  } finally {
    await act(() => Promise.resolve(pending.resolve(commitSelection(true, 1))));
  }
  expect(await screen.findByRole("button", { name: removeName })).toBeInTheDocument();
  expect(screen.getByText("Selection saved. Events are not displayed yet.")).toBeInTheDocument();
  expect(screen.getByText("Calendar synchronization is not available yet.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Meet|Join meeting/i })).not.toBeInTheDocument();
});
it("removes with the saved binding version without an optimistic state flip", async () => {
  patchEntry({ selection: receipt(true, 4) });
  const pending = deferred<ReturnType<typeof commitSelection>>();
  api.select.mockReturnValue(pending.promise);
  open();
  fireEvent.click(screen.getByRole("button", { name: removeName }));
  try {
    await waitFor(() =>
      expect(api.select).toHaveBeenCalledWith(
        {
          accountId,
          calendarId: entryId,
          selected: false,
          expectedCatalogRevision: 7,
          expectedBindingVersion: 4,
        },
        "catalog-csrf",
      ),
    );
    expect(screen.queryByRole("button", { name: addName })).not.toBeInTheDocument();
  } finally {
    await act(() => Promise.resolve(pending.resolve(commitSelection(false, 5))));
  }
  expect(await screen.findByRole("button", { name: addName })).toBeInTheDocument();
});
it("offers a persisted-list review after conflict without repeating provider discovery", async () => {
  api.select.mockResolvedValue({ ok: false, error: { id: ERROR_IDS.CALENDAR_BINDING_CONFLICT } });
  open();
  fireEvent.click(screen.getByRole("button", { name: addName }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The calendar list or selection changed. Review the latest list and try again.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Review latest list" }));
  await waitFor(() => expect(api.refetchCatalog).toHaveBeenCalledWith(accountId));
  expect(api.discover).not.toHaveBeenCalled();
});
it("escapes provider text and keeps mixed-direction names automatic", () => {
  const name = '<img src="x" onerror="bad()"> تقویم';
  patchEntry({ name });
  const view = open();
  expect(screen.getByText(name).closest('[dir="auto"]')).not.toBeNull();
  expect(view.container.querySelector('img[src="x"]')).toBeNull();
});
it("disables discovery and Add without app configuration while connected local Remove stays available", () => {
  ui.configured = false;
  patchEntry({ id: "second", name: "Selected", selection: receipt(true, 2) }, 1);
  open();
  expect(screen.getByRole("button", { name: "Fetch calendars" })).toBeDisabled();
  expect(screen.getByRole("button", { name: addName })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove Selected" })).toBeEnabled();
});
it.each(["disconnected", "reauthRequired"] as const)(
  "hides cached provider metadata when the account becomes %s",
  (status) => {
    const view = open();
    expect(screen.getByText(entryName)).toBeInTheDocument();
    patchAccount({ status });
    view.rerender(surface());
    expect(screen.queryByText(entryName)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: addName })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: removeName })).not.toBeInTheDocument();
  },
);
it("shows availability-only authority without offering an enabled Add", () => {
  patchEntry({ accessRole: "freeBusyReader", available: false });
  open();
  expect(screen.getByText("Availability only")).toBeInTheDocument();
  const add = screen.queryByRole("button", { name: addName });
  if (add !== null) expect(add).toBeDisabled();
});
it("retains prior metadata but disables Add when the persisted catalog is in error", () => {
  ui.catalog.status = "error";
  open();
  expect(screen.getByText(entryName)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: addName })).toBeDisabled();
});
it("keeps the account disclosure open across an ordinary credential-version refresh", () => {
  const view = open();
  patchAccount({ version: 2 });
  view.rerender(surface());
  expect(screen.getByRole("button", { name: "Account calendars" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByText(entryName)).toBeInTheDocument();
  expect(api.discover).not.toHaveBeenCalled();
});
it("retains cached rows but disables Add and offers retry after a failed persisted read", async () => {
  ui.queryError = true;
  open();
  expect(screen.getByText(entryName)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: addName })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The saved calendar list could not be loaded. Try again.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(api.refetchCatalog).toHaveBeenCalledWith(accountId));
  expect(api.discover).not.toHaveBeenCalled();
});
it("keeps Add blocked on the stale revision when a conflict review read fails", async () => {
  api.select.mockResolvedValue({ ok: false, error: { id: ERROR_IDS.CALENDAR_BINDING_CONFLICT } });
  const pending = deferred<{ isError: true; data: typeof ui.catalog }>();
  api.refetchCatalog.mockReturnValue(pending.promise);
  open();
  fireEvent.click(screen.getByRole("button", { name: addName }));
  fireEvent.click(await screen.findByRole("button", { name: "Review latest list" }));
  await waitFor(() => expect(api.refetchCatalog).toHaveBeenCalledWith(accountId));
  await act(async () => {
    pending.resolve({ isError: true, data: ui.catalog });
    await pending.promise;
  });
  expect(screen.getByRole("button", { name: addName })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review latest list" })).toBeEnabled();
  expect(api.select).toHaveBeenCalledTimes(1);
});
it("preserves a committed selection and its saved acknowledgment when the following read fails", async () => {
  const pending = deferred<never>();
  api.refetchCatalog.mockReturnValue(pending.promise);
  open();
  fireEvent.click(screen.getByRole("button", { name: addName }));
  await waitFor(() => expect(api.refetchCatalog).toHaveBeenCalledWith(accountId));
  await act(async () => {
    pending.reject(new TypeError("synthetic post-commit read failure"));
    await pending.promise.catch(() => undefined);
  });
  expect(screen.getByRole("button", { name: removeName })).toBeInTheDocument();
  expect(screen.getByText("Selection saved. Events are not displayed yet.")).toBeInTheDocument();
  expect(
    screen.queryByText("The calendar selection could not be saved. Try again."),
  ).not.toBeInTheDocument();
  expect(api.select).toHaveBeenCalledTimes(1);
});
it("disables Add with a clear reason for missing or invalid provider time zones", () => {
  patchEntry({ timeZone: null });
  const view = open();
  expect(screen.getByRole("button", { name: addName })).toBeDisabled();
  expect(screen.getByText("This calendar has no supported time zone.")).toBeInTheDocument();
  patchEntry({ timeZone: "Invalid/Provider_Zone" });
  view.rerender(surface());
  expect(screen.getByRole("button", { name: addName })).toBeDisabled();
  expect(screen.getByText("This calendar has no supported time zone.")).toBeInTheDocument();
});
it("hides a locally disconnected catalog after its committed acknowledgment even when the account read fails", async () => {
  patchEntry({ selection: receipt(true, 3) });
  patchEntry(
    {
      id: "e44b08f7-3d31-44c8-b973-796ad1efe9a7",
      calendarId: "second@example.invalid",
      name: "Second / دوم",
    },
    1,
  );
  const pending = deferred<never>();
  api.refetchAccounts.mockReturnValue(pending.promise);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new TypeError("unexpected HTTP during local disconnect"));
  let settled = false;
  async function rejectAccountRead(): Promise<void> {
    if (settled) return;
    settled = true;
    await act(async () => {
      pending.reject(new TypeError("synthetic account read failure"));
      await pending.promise.catch(() => undefined);
    });
  }
  try {
    open();
    expect(screen.getByText(entryName)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: removeName })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Second / دوم" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect owner@example.invalid" }));
    expect(
      await screen.findByText("The account was disconnected from this workspace."),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.refetchAccounts).toHaveBeenCalledTimes(1));
    await rejectAccountRead();
    expect(ui.accounts[0]?.status).toBe("connected");
    expect(screen.queryByText(entryName)).not.toBeInTheDocument();
    expect(screen.queryByText("Second / دوم")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: removeName })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Second / دوم" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Account calendars" })).not.toBeInTheDocument();
    expect(screen.getByText("Disconnected", { exact: true })).toBeInTheDocument();
    expect(api.disconnect).toHaveBeenCalledWith(accountId, "catalog-csrf");
    expect(api.disconnect).toHaveBeenCalledTimes(1);
    expect(api.refetchAccounts).toHaveBeenCalledTimes(1);
    expect(api.select).not.toHaveBeenCalled();
    expect(api.discover).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  } finally {
    await rejectAccountRead();
    warning.mockRestore();
    http.mockRestore();
  }
});
