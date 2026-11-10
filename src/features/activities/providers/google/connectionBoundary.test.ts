import { beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import type { AppContext } from "@/server/trpc/context";
import { calendarsRouter } from "../../calendarRouter";

const service = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./accounts", () => ({ listCalendarProviderAccounts: service.list }));
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
  session: { userId: actor.id, sessionId: "session" },
};
beforeEach(() => {
  vi.resetAllMocks();
  service.list.mockResolvedValue({ ok: true, value: [] });
});
it("requires a live protected caller before listing any account", async () => {
  const caller = calendarsRouter.createCaller({ ...context, session: null });
  await expect(caller.googleAccounts()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(service.list).not.toHaveBeenCalled();
});
it("lists only the trusted actor's account summaries without contacting the provider", async () => {
  const caller = calendarsRouter.createCaller(context);
  expect(await caller.googleAccounts()).toEqual({ configured: false, accounts: [] });
  expect(service.list).toHaveBeenCalledWith(db, actor.id, expect.any(AbortSignal));
});
it("does not expose account-service details when the owner became inactive", async () => {
  service.list.mockResolvedValue({ ok: false, error: { kind: "not_found", private: "secret" } });
  const caller = calendarsRouter.createCaller(context);
  await expect(caller.googleAccounts()).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "E_AUTH_003",
  });
});
