import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import type { AppContext } from "@/server/trpc/context";
import { calendarsRouter } from "../../calendarRouter";

const api = vi.hoisted(() => ({ list: vi.fn(), discover: vi.fn(), network: vi.fn() }));
vi.mock("./calendarCatalog", () => ({
  listGoogleCalendarCatalog: api.list,
  discoverGoogleCalendarCatalog: api.discover,
}));
const accountId = "264ce746-e40a-46f9-a963-b3cfa71b4874";
const actor: NonNullable<AppContext["actor"]> = {
  id: "6d768f82-667e-4415-997c-2a39b089bf7e",
  type: "regular",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
  name: "Owner",
  email: "owner@example.invalid",
  avatarUrl: null,
};
const context: AppContext = {
  db,
  actor,
  session: { userId: actor.id, sessionId: "catalog-boundary-session" },
};
const catalog = { accountId, revision: 0, status: "empty", calendars: [], discoveredAt: null };
beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue({ ok: true, value: catalog });
  api.network.mockRejectedValue(
    new AppError(ERROR_IDS.DB_INVARIANT, "unexpected provider request"),
  );
  vi.stubGlobal("fetch", api.network);
});
afterEach(() => {
  try {
    expect(api.network).not.toHaveBeenCalled();
    expect(api.discover).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("requires actor and session before delegating a catalog read", async () => {
  for (const missing of ["actor", "session"] as const) {
    const caller = calendarsRouter.createCaller({ ...context, [missing]: null });
    await expect(caller.googleCatalog({ accountId })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  }
  expect(api.list).not.toHaveBeenCalled();
});
it("delegates only the trusted owner and selected account to the persisted read service", async () => {
  expect(await calendarsRouter.createCaller(context).googleCatalog({ accountId })).toEqual(catalog);
  expect(api.list).toHaveBeenCalledWith(db, actor.id, accountId, expect.any(AbortSignal));
});
it("rejects client owner and role injection as BAD_REQUEST before delegation", async () => {
  const caller = calendarsRouter.createCaller(context);
  for (const field of ["ownerId", "role"]) {
    const input = { accountId, [field]: "client-authority" };
    await expect(caller.googleCatalog(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  expect(api.list).not.toHaveBeenCalled();
});
it("returns a neutral missing-account error without exposing another owner's service data", async () => {
  api.list.mockResolvedValue({
    ok: false,
    error: { kind: "not_found", message: "private-owner-detail" },
  });
  await expect(
    calendarsRouter.createCaller(context).googleCatalog({ accountId }),
  ).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: expect.stringMatching(/^E_[A-Z0-9_]+_\d+$/),
  });
});
it("returns a neutral storage error without leaking a provider payload", async () => {
  api.list.mockResolvedValue({
    ok: false,
    error: { kind: "storage", rawPayload: "private-provider-data" },
  });
  await expect(
    calendarsRouter.createCaller(context).googleCatalog({ accountId }),
  ).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: ERROR_IDS.CALENDAR_CATALOG_FAILED,
  });
});
