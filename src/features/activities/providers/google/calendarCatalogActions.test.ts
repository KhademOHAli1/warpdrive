// The exact-session admission adapter is an application boundary in these action/query
// contract tests. Its database and revocation behavior has separate real-PG coverage.
vi.mock("./calendarDomainAuthority", () => ({
  withCalendarDomainActor: <T>(
    db: Db,
    _session: unknown,
    _signal: AbortSignal,
    command: (db: Db) => Promise<T>,
  ) => command(db),
}));

import { beforeEach, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { db } from "@/db/client";
import {
  discoverGoogleCalendarsAction,
  setGoogleCalendarSelectionAction,
} from "./calendarCatalogActions";

const service = vi.hoisted(() => ({
  csrf: vi.fn(),
  context: vi.fn(),
  deployment: vi.fn(),
  discover: vi.fn(),
  select: vi.fn(),
  cache: vi.fn(),
}));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: service.csrf }));
vi.mock("@/server/trpc/context", () => ({ createContext: service.context }));
vi.mock("./authorizationDeployment", () => ({ calendarDeploymentConfig: service.deployment }));
vi.mock("./calendarCatalog", () => ({ discoverGoogleCalendarCatalog: service.discover }));
vi.mock("./calendarBindings", () => ({ setGoogleCalendarSelection: service.select }));
vi.mock("next/cache", () => ({
  revalidatePath: service.cache,
  revalidateTag: service.cache,
  updateTag: service.cache,
  refresh: service.cache,
}));

const ownerId = "6d768f82-667e-4415-997c-2a39b089bf7e";
const accountId = "264ce746-e40a-46f9-a963-b3cfa71b4874";
const calendarId = "cf30b4ee-97a1-4469-a892-e057354beaf9";
const actor = {
  id: ownerId,
  isActive: true,
  type: "regular",
  name: "Owner",
  email: "owner@example.invalid",
  avatarUrl: null,
  flags: new Set(),
  groupIds: new Set(),
};
const session = { userId: ownerId, sessionId: "catalog-action-session" };
const config = {
  clientId: "dedicated-calendar-client",
  clientSecret: "synthetic-calendar-secret",
  redirectUri: "https://app.example.com/api/calendar/google/oauth/callback",
  access: "readWrite",
};
const selection = {
  accountId,
  calendarId,
  selected: true,
  expectedCatalogRevision: 3,
  expectedBindingVersion: null,
};
const catalogValue = { accountId, revision: 3, discoveredAt: "2030-04-03T09:00:00.000Z" };
const bindingValue = {
  bindingId: "binding",
  localCalendarId: "dedicated-calendar",
  version: 1,
  selected: true,
};
const actions = {
  discover: () => discoverGoogleCalendarsAction({ accountId }, "csrf"),
  selection: () => setGoogleCalendarSelectionAction(selection, "csrf"),
};
function expectClientFailure(result: unknown): void {
  expect(result).toEqual({ ok: false, error: { id: expect.stringMatching(/^E_[A-Z0-9_]+_\d+$/) } });
}
beforeEach(() => {
  vi.resetAllMocks();
  service.csrf.mockResolvedValue({ ok: true, value: true });
  service.context.mockResolvedValue({ db, actor, session });
  service.deployment.mockReturnValue(config);
  service.discover.mockResolvedValue({ ok: true, value: catalogValue });
  service.select.mockResolvedValue({ ok: true, value: bindingValue });
  service.cache.mockImplementation(() => {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "cache refresh belongs to the caller");
  });
});

it.each(["discover", "selection"] as const)(
  "rejects failed CSRF before %s context or service work",
  async (action) => {
    service.csrf.mockResolvedValue({ ok: false, error: "csrf mismatch" });
    expectClientFailure(await actions[action]());
    expect(service.csrf).toHaveBeenCalledWith("csrf");
    expect(service.context).not.toHaveBeenCalled();
    expect(service.discover).not.toHaveBeenCalled();
    expect(service.select).not.toHaveBeenCalled();
  },
);

it.each(["actor", "session"] as const)(
  "requires an authenticated %s for both action boundaries",
  async (missing) => {
    service.context.mockResolvedValue({ db, actor, session, [missing]: null });
    for (const action of Object.values(actions)) {
      expect(await action()).toEqual({ ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } });
    }
    expect(service.discover).not.toHaveBeenCalled();
    expect(service.select).not.toHaveBeenCalled();
  },
);

it("rejects a client-supplied discovery owner instead of stripping it", async () => {
  const input = { accountId, ownerId: "client-supplied-owner" };
  expectClientFailure(await discoverGoogleCalendarsAction(input, "csrf"));
  expect(service.discover).not.toHaveBeenCalled();
});
it.each(["ownerId", "role", "localCalendarId"])(
  "rejects selection %s injection before the binding service",
  async (field) => {
    const input = { ...selection, [field]: "client-supplied-authority-or-target" };
    expectClientFailure(await setGoogleCalendarSelectionAction(input, "csrf"));
    expect(service.select).not.toHaveBeenCalled();
  },
);

it("discovers with the trusted owner, typed deployment configuration and a bounded signal", async () => {
  expect(await actions.discover()).toEqual({ ok: true, data: catalogValue });
  expect(service.deployment).toHaveBeenCalledTimes(1);
  expect(service.deployment.mock.calls[0]?.[0] === env).toBe(true);
  expect(service.discover).toHaveBeenCalledWith(
    db,
    ownerId,
    accountId,
    config,
    expect.any(AbortSignal),
    { nativeSession: session },
  );
});
it("forwards the validated selection, trusted owner and signal without adding authority fields", async () => {
  expect(await actions.selection()).toEqual({ ok: true, data: bindingValue });
  expect(service.select).toHaveBeenCalledWith(db, ownerId, selection, expect.any(AbortSignal));
});

it("rejects discovery when dedicated Calendar configuration is absent", async () => {
  service.deployment.mockReturnValue(null);
  expectClientFailure(await actions.discover());
  expect(service.discover).not.toHaveBeenCalled();
});
it("rejects Add when dedicated Calendar configuration is absent", async () => {
  service.deployment.mockReturnValue(null);
  expectClientFailure(await actions.selection());
  expect(service.select).not.toHaveBeenCalled();
});
it("allows local Remove without dedicated Calendar configuration", async () => {
  service.deployment.mockReturnValue(null);
  const input = { ...selection, selected: false, expectedBindingVersion: 1 };
  const removed = { ...bindingValue, selected: false, version: 2 };
  service.select.mockResolvedValue({ ok: true, value: removed });
  expect(await setGoogleCalendarSelectionAction(input, "csrf")).toEqual({
    ok: true,
    data: removed,
  });
  expect(service.select).toHaveBeenCalledWith(db, ownerId, input, expect.any(AbortSignal));
  expect(service.discover).not.toHaveBeenCalled();
});

it.each(["discover", "selection"] as const)(
  "maps a %s conflict to a neutral typed error without service payloads",
  async (action) => {
    const conflict = {
      ok: false,
      error: {
        kind: "conflict",
        message: "private-provider-detail",
        refreshToken: "private-refresh-token",
      },
    };
    service.discover.mockResolvedValue(conflict);
    service.select.mockResolvedValue(conflict);
    const result = await actions[action]();
    expectClientFailure(result);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(JSON.stringify(result)).not.toContain("refreshToken");
  },
);

it.each(["discover", "selection"] as const)(
  "returns committed %s data without running server cache refresh",
  async (action) => {
    expect(await actions[action]()).toEqual({
      ok: true,
      data: action === "discover" ? catalogValue : bindingValue,
    });
    expect(service.cache).not.toHaveBeenCalled();
  },
);
