import { expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ csrf: vi.fn(), fresh: vi.fn(), context: vi.fn() }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: deps.csrf }));
vi.mock("@/features/identity/actions/fresh", () => ({ requireFreshIdentityAction: deps.fresh }));
vi.mock("@/server/trpc/context", () => ({ createContext: deps.context }));

import { publishWorkflowAction } from "./actions";

it("requires fresh authentication before publishing an automation", async () => {
  deps.csrf.mockResolvedValue({ ok: true, value: true });
  deps.fresh.mockResolvedValue({ ok: false, error: "fresh_auth_required" });
  deps.context.mockResolvedValue({ actor: { id: crypto.randomUUID() }, db: null });
  expect(await publishWorkflowAction(crypto.randomUUID(), 1, "token")).toEqual({
    ok: false,
    error: "fresh_auth_required",
  });
});
