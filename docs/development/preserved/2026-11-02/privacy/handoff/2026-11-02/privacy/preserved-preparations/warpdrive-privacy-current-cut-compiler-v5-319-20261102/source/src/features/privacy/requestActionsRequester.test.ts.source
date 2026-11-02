import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/db/client";
import { err, ok } from "@/types/result";

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  headers: vi.fn(),
  session: vi.fn(),
  create: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: mocks.csrf }));
vi.mock("@/features/auth/better/sessionPolicy", () => ({ resolveWorkflowSession: mocks.session }));
vi.mock("./selfService", () => ({
  createOwnPrivacyCase: mocks.create,
  readOwnPrivacyCase: vi.fn(),
}));
vi.mock("./identitySelf", () => ({ verifyOwnPrivacyIdentity: vi.fn() }));

import { createOwnPrivacyRequestAction } from "./requestActions";

// Transport isolation only. The expected requester may deny submission but never supplies authority.
const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_SESSION_ID = "00000000-0000-4000-8000-000000000004";
const CASE_ID = "00000000-0000-4000-8000-000000000005";
const PRIVATE = "PRIVATE-EXPECTED-REQUESTER-SENTINEL";
const input = {
  intakeKey: "00000000-0000-4000-8000-000000000006",
  kind: "access",
  locale: "en",
  summary: PRIVATE,
};
const receipt = { id: CASE_ID, kind: "access", status: "received", version: 1 };
let requestHeaders: Headers;

beforeEach(() => {
  vi.resetAllMocks();
  requestHeaders = new Headers({ origin: "https://app.example.test", host: "app.example.test" });
  mocks.headers.mockResolvedValue(requestHeaders);
  mocks.csrf.mockResolvedValue(ok(true));
  mocks.session.mockResolvedValue({ user: { id: USER_ID }, session: { id: SESSION_ID } });
  mocks.create.mockResolvedValue(ok(receipt));
});

test.each([
  { label: "missing", expected: undefined },
  { label: "null", expected: null },
  { label: "empty", expected: "" },
  { label: "not a UUID", expected: PRIVATE },
  { label: "number", expected: 42 },
  { label: "object", expected: { userId: USER_ID } },
  { label: "array", expected: [USER_ID] },
])("rejects a $label expected requester without delegating intake", async ({ expected }) => {
  const result = await createOwnPrivacyRequestAction("csrf", input, expected);

  expect(result).toEqual(err("invalid_input"));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
});

test.each([
  {
    label: "native user changed",
    userId: OTHER_USER_ID,
    sessionId: OTHER_SESSION_ID,
    expected: USER_ID,
  },
  {
    label: "forged selector",
    userId: USER_ID,
    sessionId: SESSION_ID,
    expected: OTHER_USER_ID,
  },
])("denies a $label rather than deriving the actor from the selector", async (subject) => {
  mocks.session.mockResolvedValueOnce({
    user: { id: subject.userId },
    session: { id: subject.sessionId },
  });

  const result = await createOwnPrivacyRequestAction("csrf", input, subject.expected);

  expect(result).toEqual(err("requester_changed"));
  expect(mocks.session).toHaveBeenCalledWith(db, requestHeaders, expect.any(AbortSignal), {
    requireFresh: true,
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|00000000-/);
});

test("CSRF denial precedes even an invalid expected requester", async () => {
  mocks.csrf.mockResolvedValueOnce(err(PRIVATE));

  const result = await createOwnPrivacyRequestAction(null, input, { userId: PRIVATE });

  expect(result).toEqual(err("csrf_rejected"));
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
});

test("a matching selector delegates once with only the fresh native actor and original intake", async () => {
  const result = await createOwnPrivacyRequestAction("csrf", input, USER_ID);
  const signal: unknown = mocks.session.mock.calls[0]?.[2];

  expect(result).toEqual(ok(receipt));
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledWith(
    db,
    { userId: USER_ID, sessionId: SESSION_ID },
    input,
    signal,
  );
  expect(JSON.stringify(structuredClone(result))).not.toContain(PRIVATE);
  expect(JSON.stringify(result)).not.toContain(USER_ID);
});
