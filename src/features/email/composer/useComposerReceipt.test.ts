// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const status = vi.fn();
const cancel = vi.fn();
vi.mock("../sendStatusAction", () => ({
  getSendStatusAction: (...args: unknown[]) => status(...args),
}));
vi.mock("../folderActions", () => ({
  cancelOutboxAction: (...args: unknown[]) => cancel(...args),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { useComposerReceipt } from "./useComposerReceipt";

beforeEach(() => {
  status.mockReset();
  cancel.mockReset();
});
it("checks the existing request through the receipt-only action and keeps its identity", async () => {
  const outcome = { status: "needs_review", deliveryOutcome: { state: "unknown" as const } };
  status.mockResolvedValue({ ok: true, value: outcome });
  const onOutcome = vi.fn();
  const onNewIntent = vi.fn();
  const { result } = renderHook(() =>
    useComposerReceipt({
      accountId: "mailbox",
      intentId: "intent",
      outcome,
      onOutcome,
      onNewIntent,
    }),
  );
  await act(async () => {
    await result.current.check();
  });
  expect(status).toHaveBeenCalledWith("csrf", { accountId: "mailbox", idempotencyKey: "intent" });
  expect(onOutcome).toHaveBeenCalledWith(outcome);
  expect(onNewIntent).not.toHaveBeenCalled();
});
it("creates a fresh editable intent only after the old rejected request is cancelled", async () => {
  cancel.mockResolvedValue({ ok: false, error: { id: "E_GMAIL_017" } });
  const onNewIntent = vi.fn();
  const { result } = renderHook(() =>
    useComposerReceipt({
      accountId: "mailbox",
      intentId: "intent",
      outcome: { status: "failed", attemptId: "attempt", deliveryOutcome: { state: "rejected" } },
      onOutcome: vi.fn(),
      onNewIntent,
    }),
  );
  await act(async () => {
    await result.current.confirmEdit();
  });
  expect(onNewIntent).not.toHaveBeenCalled();
  expect(result.current.error).not.toBeNull();
  cancel.mockResolvedValue({ ok: true, value: { id: "attempt" } });
  await act(async () => {
    await result.current.confirmEdit();
  });
  expect(cancel).toHaveBeenLastCalledWith("csrf", { attemptId: "attempt" });
  expect(onNewIntent).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9-]{36}$/));
});
it("never offers a new send intent for an unknown or partially accepted request", async () => {
  const onNewIntent = vi.fn();
  const { result } = renderHook(() =>
    useComposerReceipt({
      accountId: "mailbox",
      intentId: "intent",
      outcome: {
        status: "needs_review",
        attemptId: "attempt",
        deliveryOutcome: { state: "unknown" },
      },
      onOutcome: vi.fn(),
      onNewIntent,
    }),
  );
  await act(async () => {
    await result.current.confirmEdit();
  });
  expect(cancel).not.toHaveBeenCalled();
  expect(onNewIntent).not.toHaveBeenCalled();
});
