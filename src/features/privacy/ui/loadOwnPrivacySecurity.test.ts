import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SecurityStatus, WorkflowResponse } from "@/features/auth/better/contracts";
import type * as WorkflowRequest from "@/features/auth/ui/workflowRequest";
import { statusSchema } from "@/features/auth/ui/workflowRequest";
import { err, ok } from "@/types/result";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/features/auth/ui/workflowRequest", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkflowRequest>()),
  workflowRequest: mocks.request,
}));

import { loadOwnPrivacySecurity } from "./loadOwnPrivacySecurity";

// The workflow helper owns HTTP JSON validation. This boundary isolates loader result mapping
// and caller cancellation, with a complete synthetic DTO and no database or provider access.
const PRIVATE = "PRIVATE-SECURITY-LOADER-SENTINEL";
const status: SecurityStatus = {
  authenticated: true,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Synthetic requester",
    email: "synthetic-requester@example.test",
    isAdmin: false,
  },
  emailVerified: true,
  hasPassword: true,
  twoFactorEnabled: true,
  needsMfa: false,
  needsEnrollment: false,
  fresh: true,
  authMethod: "password",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 12, freshMinutes: 5 },
  accounts: [
    { id: "synthetic-account", providerId: "credential", accountId: "synthetic-account-reference" },
  ],
  passkeys: [
    {
      id: "synthetic-passkey",
      name: "Synthetic key",
      createdAt: "2026-11-01T08:00:00.000Z",
      deviceType: "singleDevice",
      backedUp: false,
    },
  ],
  sessions: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      current: true,
      createdAt: "2026-11-01T09:00:00.000Z",
      lastSeenAt: "2026-11-01T10:00:00.000Z",
      expiresAt: "2026-11-01T12:00:00.000Z",
      ipAddress: "192.0.2.1",
      userAgent: "Synthetic security loader unit test",
    },
  ],
  recoveryCodesAvailable: true,
  audit: [
    {
      id: "synthetic-security-event",
      action: "fresh.authenticate",
      outcome: "success",
      createdAt: "2026-11-01T10:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockResolvedValue({ ok: true, data: status });
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("loads an authenticated fresh DTO through the fixed status path and schema", async () => {
  const controller = new AbortController();

  const result = await loadOwnPrivacySecurity(controller.signal);

  expect(result).toEqual(ok(status));
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenCalledWith("status", statusSchema, expect.any(AbortSignal));
  expect(mocks.request.mock.calls[0]?.[2]).toMatchObject({ aborted: false });
});

test("only an authoritative expired-session response becomes an absent security status", async () => {
  mocks.request.mockResolvedValueOnce({ ok: false, error: "SESSION_EXPIRED" });

  expect(await loadOwnPrivacySecurity(new AbortController().signal)).toEqual(ok(null));
});

test.each([
  "INVALID_RESPONSE",
  "RATE_LIMITED",
  "FORBIDDEN",
  "POLICY_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  PRIVATE,
])("maps workflow failure %s to unavailable without reflecting its details", async (error) => {
  mocks.request.mockResolvedValueOnce({ ok: false, error });

  const result = await loadOwnPrivacySecurity(new AbortController().signal);

  expect(result).toEqual(err("unavailable"));
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
});

test("bounds a thrown transport error without exposing account data or logging its payload", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.request.mockRejectedValueOnce(new Error(`${PRIVATE}: ${status.user.email}`));

  const result = await loadOwnPrivacySecurity(new AbortController().signal);

  expect(result).toEqual(err("unavailable"));
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
  expect(JSON.stringify(result)).not.toContain(status.user.email);
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledWith("status", statusSchema, expect.any(AbortSignal));
});

test("a pre-aborted caller prevents the workflow request", async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(loadOwnPrivacySecurity(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });

  expect(mocks.request).not.toHaveBeenCalled();
});

test("caller abort during an await aborts the transport signal and rejects a late success", async () => {
  const controller = new AbortController();
  let resolveResponse: ((response: WorkflowResponse<SecurityStatus>) => void) | undefined;
  mocks.request.mockReturnValueOnce(
    new Promise<WorkflowResponse<SecurityStatus>>((resolve) => {
      resolveResponse = resolve;
    }),
  );
  const pending = loadOwnPrivacySecurity(controller.signal);
  await Promise.resolve();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });

  controller.abort();
  resolveResponse?.({ ok: true, data: status });

  await cancelled;
  expect(mocks.request.mock.calls[0]?.[2]).toMatchObject({ aborted: true });
});

test("preserves a rejected AbortError instead of turning cancellation into unavailable", async () => {
  const cancellation = new DOMException("Synthetic cancellation", "AbortError");
  mocks.request.mockRejectedValueOnce(cancellation);

  await expect(loadOwnPrivacySecurity(new AbortController().signal)).rejects.toBe(cancellation);
});
