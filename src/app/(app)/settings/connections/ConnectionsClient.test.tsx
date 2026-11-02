// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { MockActionResult } from "@/test/actionResult";
import { ConnectionsClient } from "./ConnectionsClient";

const api = vi.hoisted(() => ({
  disconnect: vi.fn(),
  refetch: vi.fn(),
  revoke: vi.fn<() => Promise<MockActionResult>>(),
  refresh: vi.fn(),
}));
const { revoke, refresh } = api;
const fixture = vi.hoisted(() => ({
  configured: false,
  accounts: [] as Array<{
    id: string;
    emailAddress: string;
    status: "connected" | "reauthRequired" | "disconnected";
  }>,
  isError: false,
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: api.refresh }),
  useSearchParams: () => new URLSearchParams(fixture.search),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "calendar-csrf" }));
vi.mock("@/features/oauth/revokeAction", () => ({ revokeConnectionAction: api.revoke }));
vi.mock("@/features/activities/providers/google/connectionActions", () => ({
  disconnectGoogleCalendarAction: api.disconnect,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    calendars: {
      googleAccounts: {
        useQuery: () => ({
          data: fixture.isError
            ? undefined
            : { configured: fixture.configured, accounts: fixture.accounts },
          isError: fixture.isError,
          refetch: api.refetch,
        }),
      },
    },
  },
}));
beforeEach(() => {
  fixture.configured = false;
  fixture.accounts = [];
  fixture.isError = false;
  fixture.search = "";
  api.refetch.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
function show(locale: "en" | "fa" | "de" = "en") {
  return render(
    <LocaleProvider locale={locale}>
      <ConnectionsClient connections={[]} />
    </LocaleProvider>,
  );
}
it.each([
  ["fa", "تقویم Google", "اتصال Google Calendar در این فضای کاری هنوز تنظیم نشده است."],
  [
    "de",
    "Google-Kalender",
    "Google Calendar ist für diesen Arbeitsbereich noch nicht eingerichtet.",
  ],
] as const)("explains the unconfigured Calendar connection in %s", (locale, title, message) => {
  show(locale);
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button")).toBeDisabled();
});
it("preserves the separate MCP connection list", () => {
  render(
    <ConnectionsClient
      connections={[
        {
          clientId: "mcp",
          clientName: "Research client",
          connectedAtIso: null,
          lastUsedAtIso: null,
        },
      ]}
    />,
  );
  expect(screen.getByRole("heading", { name: "Google Calendar" })).toBeInTheDocument();
  expect(screen.getByText("Research client")).toBeInTheDocument();
});
it("starts Calendar authorization with the same-origin CSRF request and no owner ID", async () => {
  fixture.configured = true;
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: 503 }),
    );
  vi.stubGlobal("fetch", fetcher);
  show();
  fireEvent.click(screen.getByRole("button", { name: "Connect Google Calendar" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/calendar/google/oauth/start",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: "{}",
        signal: expect.any(AbortSignal),
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "calendar-csrf" },
      }),
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Google Calendar could not be connected. Try again.",
  );
});
it("reconnects the selected account and offers local disconnect while the app is unconfigured", async () => {
  fixture.accounts = [
    { id: "account-1", emailAddress: "owner@example.invalid", status: "reauthRequired" },
  ];
  api.disconnect.mockResolvedValue({ ok: true });
  const view = show();
  expect(screen.getByRole("button", { name: "Reconnect owner@example.invalid" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect owner@example.invalid" }));
  await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith("account-1", "calendar-csrf"));
  await waitFor(() => expect(api.refetch).toHaveBeenCalledTimes(1));
  fixture.configured = true;
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: 503 }),
    );
  vi.stubGlobal("fetch", fetcher);
  view.rerender(
    <LocaleProvider locale="en">
      <ConnectionsClient connections={[]} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reconnect owner@example.invalid" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ accountId: "account-1" }) }),
    ),
  );
});
it("keeps authoritative account status and never claims synchronization from a callback query", () => {
  fixture.configured = true;
  fixture.search = "googleConnect=connected";
  show();
  expect(screen.getByText("No Google Calendar account is connected.")).toBeInTheDocument();
  expect(
    screen.getByText("Google authorization finished. Check the account status below."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Account connected")).not.toBeInTheDocument();
});
it("renders account connection separately from calendar synchronization", () => {
  fixture.configured = true;
  fixture.accounts = [
    { id: "account-1", emailAddress: "owner@example.invalid", status: "connected" },
  ];
  show();
  expect(screen.getByText("Account connected")).toBeInTheDocument();
  expect(screen.getByText("Calendar synchronization is not available yet.")).toBeInTheDocument();
});
it("allows retrying account load and ignores arbitrary callback content", async () => {
  fixture.isError = true;
  fixture.search = "googleConnect=private-provider-error";
  show();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your Google Calendar accounts could not be loaded.",
  );
  expect(screen.queryByText("private-provider-error")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(api.refetch).toHaveBeenCalledTimes(1));
});

const connections = [
  { clientId: "c1", clientName: "Claude Desktop", connectedAtIso: null, lastUsedAtIso: null },
];

it("explains the named app's lost access before revoking and can cancel", () => {
  render(<ConnectionsClient connections={connections} />);
  fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));
  const dialog = screen.getByRole("alertdialog", { name: "Revoke Claude Desktop?" });
  expect(dialog).toHaveTextContent("Claude Desktop will lose access to Warpdrive");
  expect(revoke).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
});

it.each(["result", "transport"])(
  "recovers from a %s revoke failure without removing the app",
  async (failure) => {
    let finish: (value: MockActionResult) => void = () => {};
    let reject: (reason: TypeError) => void = () => {};
    revoke.mockImplementationOnce(
      () =>
        new Promise((resolve, fail) => {
          finish = resolve;
          reject = fail;
        }),
    );
    render(<ConnectionsClient connections={connections} />);
    fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revoke" }),
    );
    expect(revoke).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Revoking/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Revoking/ }));
    expect(revoke).toHaveBeenCalledOnce();
    if (failure === "result") finish({ ok: false, error: { id: "E_PERM_001" } });
    else reject(new TypeError("connection lost"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not revoke");
    await waitFor(() => expect(screen.getByRole("button", { name: /Revoke/ })).toBeEnabled());
    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  },
);

it("links mailbox sync to its actual settings page", () => {
  render(<ConnectionsClient connections={[]} />);
  expect(screen.getByRole("link", { name: "Open Email sync" })).toHaveAttribute(
    "href",
    "/settings/email-sync",
  );
});
