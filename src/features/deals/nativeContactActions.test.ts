import { afterEach, expect, test, vi } from "vitest";

const { csrf, context, org, person } = vi.hoisted(() => ({
  csrf: vi.fn<
    (token: string | null) => Promise<{ ok: true; value: true } | { ok: false; error: string }>
  >(() => Promise.resolve({ ok: true, value: true })),
  context: vi.fn(() => Promise.resolve({ actor: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } })),
  org: vi.fn(() => Promise.resolve({ ok: true as const, value: { id: "created-org" } })),
  person: vi.fn(() => Promise.resolve({ ok: true as const, value: { id: "created-person" } })),
}));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: csrf }));
vi.mock("@/server/trpc/context", () => ({ createContext: context }));
vi.mock("@/features/contacts/actions", () => ({
  createOrgAction: org,
  createPersonAction: person,
}));

import { createDealOrgAction, createDealPersonAction } from "./nativeContactActions";

afterEach(() => vi.clearAllMocks());
test("A-owned inline requests under B context are rejected before either contact delegate", async () => {
  const wrong = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  expect(
    await createDealOrgAction(
      wrong,
      { name: "A organization", address: null, customFields: {} },
      "csrf",
    ),
  ).toEqual({ ok: false, error: { id: "E_AUTH_003" } });
  expect(
    await createDealPersonAction(
      wrong,
      { name: "A person", phones: [], emails: [], orgId: null, customFields: {} },
      "csrf",
    ),
  ).toEqual({ ok: false, error: { id: "E_AUTH_003" } });
  expect(org).not.toHaveBeenCalled();
  expect(person).not.toHaveBeenCalled();
});
test("CSRF denial precedes account lookup and contact delegation", async () => {
  csrf.mockResolvedValueOnce({ ok: false, error: "denied" });
  expect(
    await createDealOrgAction(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { name: "A organization", address: null, customFields: {} },
      null,
    ),
  ).toEqual({ ok: false, error: { id: "E_AUTH_CSRF" } });
  expect(context).not.toHaveBeenCalled();
  expect(org).not.toHaveBeenCalled();
});
test("matching fixed request context delegates the unchanged contact validation path", async () => {
  const input = { name: "A organization", address: null, customFields: {} };
  expect(await createDealOrgAction("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", input, "csrf")).toEqual({
    ok: true,
    value: { id: "created-org" },
  });
  expect(org).toHaveBeenCalledWith(input, "csrf");
});
