import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fresh: vi.fn(),
  assign: vi.fn(),
  admin: vi.fn(),
  active: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("./shared", () => ({
  guardCsrf: () => Promise.resolve({ ok: true }),
  runWithActor: async (_actor: unknown, body: (actor: unknown) => Promise<unknown>) =>
    body({ id: "actor", type: "admin" }),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: { id: "actor", type: "admin" } }),
}));
vi.mock("@/features/auth/better/sessionPolicy", () => ({ resolveWorkflowSession: mocks.fresh }));
vi.mock("@/features/identity/users.service", () => ({
  assignPermissionSet: mocks.assign,
  setUserAdmin: mocks.admin,
  setUserActive: mocks.active,
}));

import { assignPermissionSetAction, setUserActiveAction, setUserAdminAction } from "./users";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fresh.mockResolvedValue(null);
  for (const operation of [mocks.assign, mocks.admin, mocks.active])
    operation.mockResolvedValue({ ok: true, value: true });
});
test("legacy administrator server actions cannot bypass fresh authentication", async () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  expect(await setUserAdminAction("csrf", { userId: id, isAdmin: true })).toEqual({
    ok: false,
    error: "fresh_auth_required",
  });
  expect(await setUserActiveAction("csrf", { userId: id, isActive: false })).toEqual({
    ok: false,
    error: "fresh_auth_required",
  });
  expect(await assignPermissionSetAction("csrf", { userId: id, setId: id })).toEqual({
    ok: false,
    error: "fresh_auth_required",
  });
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.active).not.toHaveBeenCalled();
  expect(mocks.assign).not.toHaveBeenCalled();
});
