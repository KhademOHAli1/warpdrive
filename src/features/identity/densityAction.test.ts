import { afterEach, expect, it, vi } from "vitest";

const { guard, context, write } = vi.hoisted(() => ({
  guard: vi.fn(() => Promise.resolve({ ok: true })),
  context: vi.fn<() => Promise<{ actor: { id: string } | null }>>(() =>
    Promise.resolve({ actor: { id: "user-1" } }),
  ),
  write: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: guard }));
vi.mock("@/server/trpc/context", () => ({ createContext: context }));
vi.mock("./preferencesRepo", () => ({
  setPreferences: write,
  setSidebarSectionsPreference: vi.fn(),
}));

import { setDensityAction } from "./preferencesActions";

afterEach(() => {
  vi.clearAllMocks();
});

it("writes only the density column for the authenticated account", async () => {
  expect(await setDensityAction({ density: "compact" }, "csrf")).toEqual({ ok: true });
  expect(guard).toHaveBeenCalledWith("csrf");
  expect(write).toHaveBeenCalledWith({}, "user-1", { density: "compact" }, expect.any(AbortSignal));
});

it("rejects a missing CSRF token before any preference write", async () => {
  guard.mockResolvedValueOnce({ ok: false });
  expect(await setDensityAction({ density: "compact" })).toEqual({
    ok: false,
    error: { id: "E_AUTH_CSRF" },
  });
  expect(write).not.toHaveBeenCalled();
  expect(context).not.toHaveBeenCalled();
});

it("requires an authenticated account", async () => {
  context.mockResolvedValueOnce({ actor: null });
  expect((await setDensityAction({ density: "compact" }, "csrf")).ok).toBe(false);
  expect(write).not.toHaveBeenCalled();
});
