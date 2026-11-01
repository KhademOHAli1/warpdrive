import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/db/client";
import { err, ok } from "@/types/result";

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  headers: vi.fn(),
  session: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: mocks.csrf }));
vi.mock("@/features/auth/better/sessionPolicy", () => ({ resolveWorkflowSession: mocks.session }));
vi.mock("./selfService", () => ({
  createOwnPrivacyCase: mocks.create,
  readOwnPrivacyCase: mocks.read,
}));
vi.mock("./identitySelf", () => ({ verifyOwnPrivacyIdentity: mocks.verify }));

import {
  createOwnPrivacyRequestAction,
  readOwnPrivacyRequestAction,
  verifyOwnPrivacyRequestAction,
} from "./requestActions";

// Transport-boundary tests only. Domain services and session resolution are isolated;
// no database is mocked, queried or qualified by this file.
const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const CASE_ID = "00000000-0000-4000-8000-000000000003";
const COMMAND_ID = "00000000-0000-4000-8000-000000000004";
const FORGED_ID = "00000000-0000-4000-8000-000000000005";
const PRIVATE = "PRIVATE-REQUEST-ACTION-SENTINEL";
const receivedAt = new Date("2026-11-01T10:00:00.000Z");
const minimalReceipt = {
  id: CASE_ID,
  kind: "access",
  status: "received",
  version: 1,
  receivedAt,
};
const nativeSession = { user: { id: USER_ID }, session: { id: SESSION_ID } };
let requestHeaders: Headers;

const actions = [
  {
    name: "create",
    action: (csrf: string | null, input: unknown) =>
      createOwnPrivacyRequestAction(csrf, input, USER_ID),
    service: mocks.create,
    input: () => ({ intakeKey: COMMAND_ID, kind: "access", locale: "fa", summary: PRIVATE }),
    success: () => ({ ...minimalReceipt }),
  },
  {
    name: "read",
    action: readOwnPrivacyRequestAction,
    service: mocks.read,
    input: () => ({ caseId: CASE_ID }),
    success: () => ({ ...minimalReceipt, dueAt: null }),
  },
  {
    name: "verify",
    action: verifyOwnPrivacyRequestAction,
    service: mocks.verify,
    input: () => ({ caseId: CASE_ID, expectedVersion: 1, commandId: COMMAND_ID }),
    success: () => ({ ...minimalReceipt, version: 2 }),
  },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  requestHeaders = new Headers({
    origin: "https://app.example.test",
    host: "app.example.test",
    "sec-fetch-site": "same-origin",
    cookie: `wd_sid=${PRIVATE}`,
  });
  mocks.headers.mockResolvedValue(requestHeaders);
  mocks.csrf.mockResolvedValue(ok(true));
  mocks.session.mockResolvedValue(nativeSession);
  for (const subject of actions) subject.service.mockResolvedValue(ok(subject.success()));
});

for (const subject of actions) {
  describe(`${subject.name} own privacy action boundary`, () => {
    test.each([
      [null, "missing csrf token"],
      ["wrong-token", "csrf token mismatch"],
      ["csrf", "origin mismatch"],
      ["csrf", "cross-site request rejected"],
      ["csrf", PRIVATE],
    ])(
      "rejects CSRF/origin failure %s / %s before session or service lookup",
      async (token, failure) => {
        mocks.csrf.mockResolvedValueOnce(err(failure));

        const result = await subject.action(token, subject.input());

        expect(result).toEqual(err("csrf_rejected"));
        expect(mocks.csrf).toHaveBeenCalledTimes(1);
        expect(mocks.csrf).toHaveBeenCalledWith(token);
        expect(mocks.headers).not.toHaveBeenCalled();
        expect(mocks.session).not.toHaveBeenCalled();
        for (const operation of actions) expect(operation.service).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain(PRIVATE);
      },
    );

    test("a stale or revoked native resolver result denies before the domain service", async () => {
      mocks.session.mockResolvedValueOnce(null);

      const result = await subject.action("csrf", subject.input());

      expect(result).toEqual(err("fresh_auth_required"));
      expect(mocks.session).toHaveBeenCalledWith(db, requestHeaders, expect.any(AbortSignal), {
        requireFresh: true,
      });
      expect(subject.service).not.toHaveBeenCalled();
    });

    test("derives internal actor IDs from the fresh native session and forwards one required signal", async () => {
      const input = subject.input();

      const result = await subject.action("csrf", input);

      const signal: unknown = mocks.session.mock.calls[0]?.[2];
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(mocks.csrf).toHaveBeenCalledTimes(1);
      expect(mocks.csrf).toHaveBeenCalledWith("csrf");
      expect(mocks.session).toHaveBeenCalledTimes(1);
      expect(mocks.session).toHaveBeenCalledWith(db, requestHeaders, signal, {
        requireFresh: true,
      });
      expect(subject.service).toHaveBeenCalledTimes(1);
      expect(subject.service).toHaveBeenCalledWith(
        db,
        { userId: USER_ID, sessionId: SESSION_ID },
        input,
        signal,
      );
      expect(mocks.csrf.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.session.mock.invocationCallOrder[0] ?? 0,
      );
      expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(
        subject.service.mock.invocationCallOrder[0] ?? 0,
      );
      expect(result).toEqual(ok(subject.success()));
      expect(structuredClone(result)).toEqual(result);
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|metadataEnc|subjectEnc|recipientEnc/);
      expect(JSON.stringify(result)).not.toContain(SESSION_ID);
      expect(JSON.stringify(result)).not.toContain(USER_ID);
    });

    test.each([
      { actor: { userId: FORGED_ID, sessionId: FORGED_ID } },
      { userId: FORGED_ID },
      { sessionId: FORGED_ID },
    ])(
      "keeps the native actor when the strict domain boundary rejects extra fields %j",
      async (extra) => {
        const input = { ...subject.input(), ...extra };
        subject.service.mockResolvedValueOnce(err("invalid_input"));

        const result = await subject.action("csrf", input);

        expect(result).toEqual(err("invalid_input"));
        expect(subject.service).toHaveBeenCalledTimes(1);
        expect(subject.service).toHaveBeenCalledWith(
          db,
          { userId: USER_ID, sessionId: SESSION_ID },
          input,
          expect.any(AbortSignal),
        );
      },
    );

    test.each(["session", "service"] as const)(
      "minimizes unexpected thrown %s errors without exposing driver or secret details",
      async (phase) => {
        const target = phase === "session" ? mocks.session : subject.service;
        target.mockRejectedValueOnce(new Error(PRIVATE));

        const result = await subject.action("csrf", subject.input());

        expect(result).toEqual(err("request_failed"));
        expect(JSON.stringify(structuredClone(result))).not.toContain(PRIVATE);
      },
    );

    test.each(["session", "service"] as const)(
      "preserves %s AbortError rather than converting cancellation into an action retry",
      async (phase) => {
        const target = phase === "session" ? mocks.session : subject.service;
        target.mockRejectedValueOnce(new DOMException("Synthetic cancellation", "AbortError"));

        await expect(subject.action("csrf", subject.input())).rejects.toMatchObject({
          name: "AbortError",
        });
      },
    );

    test("normalizes unexpected service failure values to one bounded result", async () => {
      subject.service.mockResolvedValueOnce(err({ message: PRIVATE, token: PRIVATE }));

      const result = await subject.action("csrf", subject.input());

      expect(result).toEqual(err("request_failed"));
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
    });
  });
}

test.each([
  "forbidden",
  "not_found",
  "idempotency_conflict",
  "storage_unavailable",
  "stale_version",
  "evidence_unavailable",
  "case_not_mutable",
] as const)(
  "retains the safe domain failure literal %s without reflecting input",
  async (failure) => {
    mocks.verify.mockResolvedValueOnce(err(failure));

    const result = await verifyOwnPrivacyRequestAction("csrf", actions[2].input());

    expect(result).toEqual(err(failure));
    expect(structuredClone(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  },
);
