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
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { db } from "@/db/client";
import { CSRF_COOKIE } from "@/features/auth/csrf";
import { disconnectGoogleCalendarAction } from "./connectionActions";

const service = vi.hoisted(() => ({ disconnect: vi.fn(), context: vi.fn() }));
const headers = new Map<string, string>();
const cookies = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: (key: string) => headers.get(key) ?? null }),
  cookies: () =>
    Promise.resolve({
      get: (key: string) => {
        const value = cookies.get(key);
        return value === undefined ? undefined : { value };
      },
    }),
}));
vi.mock("@/server/trpc/context", () => ({ createContext: service.context }));
vi.mock("./accounts", () => ({ disconnectCalendarProviderAccount: service.disconnect }));
const ownerId = "6d768f82-667e-4415-997c-2a39b089bf7e";
const accountId = "264ce746-e40a-46f9-a963-b3cfa71b4874";
beforeEach(() => {
  vi.resetAllMocks();
  headers.clear();
  headers.set("origin", "https://app.example.com");
  headers.set("sec-fetch-site", "same-origin");
  cookies.clear();
  cookies.set(CSRF_COOKIE, "csrf");
  service.context.mockResolvedValue({
    db,
    actor: { id: ownerId },
    session: { userId: ownerId, sessionId: "native-session" },
  });
  service.disconnect.mockResolvedValue({ ok: true, value: undefined });
});
it("rejects missing or cross-origin CSRF before reading context or disconnecting", async () => {
  expect(await disconnectGoogleCalendarAction(accountId, null)).toEqual({
    ok: false,
    error: { id: ERROR_IDS.AUTH_STATE_MISMATCH },
  });
  headers.set("origin", "https://attacker.invalid");
  expect((await disconnectGoogleCalendarAction(accountId, "csrf")).ok).toBe(false);
  expect(service.context).not.toHaveBeenCalled();
  expect(service.disconnect).not.toHaveBeenCalled();
});
it("requires both authenticated actor and session", async () => {
  for (const context of [
    { db, actor: null, session: null },
    { db, actor: { id: ownerId }, session: null },
  ]) {
    service.context.mockResolvedValue(context);
    expect(await disconnectGoogleCalendarAction(accountId, "csrf")).toEqual({
      ok: false,
      error: { id: ERROR_IDS.AUTH_SESSION_DEAD },
    });
  }
  expect(service.disconnect).not.toHaveBeenCalled();
});
it("validates the selected account and forwards only the trusted actor owner", async () => {
  expect(await disconnectGoogleCalendarAction("not-a-uuid", "csrf")).toEqual({
    ok: false,
    error: { id: "E_CALENDAR_004" },
  });
  expect(service.disconnect).not.toHaveBeenCalled();
  expect((await disconnectGoogleCalendarAction(accountId, "csrf")).ok).toBe(true);
  expect(service.disconnect).toHaveBeenCalledWith(db, ownerId, accountId, expect.any(AbortSignal));
});
it("returns a neutral missing-account error without exposing other owners or service data", async () => {
  service.disconnect.mockResolvedValue({
    ok: false,
    error: { kind: "not_found", private: "secret" },
  });
  expect(await disconnectGoogleCalendarAction(accountId, "csrf")).toEqual({
    ok: false,
    error: { id: "E_CALENDAR_005" },
  });
});
it("allows local disconnect even when the Calendar OAuth app is unconfigured", async () => {
  expect((await disconnectGoogleCalendarAction(accountId, "csrf")).ok).toBe(true);
  expect(service.disconnect).toHaveBeenCalledTimes(1);
});
