import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { BookingAutomationAccess } from "./automations/contracts";
import { BookingsLive } from "./BookingsLive";
import type { BookingsWorkspace } from "./contracts";

const mocked = vi.hoisted(() => ({
  notices: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  runs: vi.fn().mockResolvedValue({ ok: false, error: "unavailable" }),
  save: vi.fn().mockResolvedValue({ ok: false, error: "unavailable" }),
  retry: vi.fn().mockResolvedValue({ ok: false, error: "unavailable" }),
  workspace: vi.fn<(props: { automationAccess?: BookingAutomationAccess }) => null>(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        assets: {
          bookings: {
            automations: {
              notices: { query: mocked.notices },
              runs: { query: mocked.runs },
            },
          },
        },
      },
    }),
  },
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "current-csrf" }));
vi.mock("./automations/webActions", () => ({
  saveBookingAutomationProfileAction: mocked.save,
  retryBookingAutomationRunAction: mocked.retry,
}));
vi.mock("./ui/BookingWorkspace", () => ({ BookingWorkspace: mocked.workspace }));

const workspace: BookingsWorkspace = {
  viewer: { id: "actor", name: "Equipment requester" },
  sites: [],
  locations: [],
  resources: [],
  bookings: [],
  calendar: [],
  maintenance: [],
};

function browserPort(initial: BookingsWorkspace) {
  renderToStaticMarkup(<BookingsLive initial={initial} actorId="actor" canBrowseAssets={false} />);
  return mocked.workspace.mock.lastCall?.[0].automationAccess;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("keeps the automation port absent when an earlier Core omits its capability", () => {
  expect(browserPort(workspace)).toBeUndefined();
  expect(mocked.notices).not.toHaveBeenCalled();
  expect(mocked.runs).not.toHaveBeenCalled();
});

test("uses the typed read input and current CSRF on only the explicit mutation", async () => {
  const port = browserPort({ ...workspace, automationsAvailable: true });
  expect(port).toBeDefined();
  expect(mocked.notices).not.toHaveBeenCalled();
  expect(mocked.retry).not.toHaveBeenCalled();
  const bookingId = "361eba2b-7365-4e4c-a306-000000000001";
  const signal = new AbortController().signal;
  await port?.readNotices(bookingId, signal);
  expect(mocked.notices).toHaveBeenCalledExactlyOnceWith({ bookingId }, { signal });
  const retry = { siteId: "site", runId: "run", failureId: "failed", requestId: "request" };
  await port?.retry(retry);
  expect(mocked.retry).toHaveBeenCalledExactlyOnceWith("actor", retry, "current-csrf");
});
