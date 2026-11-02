// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import type { SendEmailOutcome } from "@/types/mail";

const send = vi.fn<(...args: unknown[]) => Promise<{ ok: true; value: SendEmailOutcome }>>();
const remove = vi.fn(() => Promise.resolve({ ok: true, value: { id: "draft" } }));
vi.mock("../actions", () => ({ sendEmail: (...args: unknown[]) => send(...args) }));
vi.mock("../folderActions", () => ({
  deleteDraftAction: (...args: unknown[]) => remove(...(args as [])),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/activities/actions", () => ({
  createActivityAction: () => Promise.resolve({ ok: true, value: { id: "activity" } }),
}));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/inbox/compose",
}));
vi.mock("next/navigation", () => ({ unstable_isUnrecognizedActionError: () => false }));

import { buildSendHandlers } from "./useComposerSend";

type Deps = Parameters<typeof buildSendHandlers>[0];
const deps = (over: Partial<Deps> = {}): Deps => ({
  accountId: "mailbox",
  resolvedThreadId: undefined,
  toList: ["customer@example.com"],
  ccList: [],
  bccList: [],
  subject: "سلام",
  body: "<p>Grüße</p>",
  trackOpens: false,
  trackLinks: false,
  visibility: "private",
  signatureId: "",
  attachments: [],
  context: undefined,
  activityTypes: [],
  addAsActivity: false,
  setSending: vi.fn(),
  setError: vi.fn(),
  resetDraft: vi.fn(),
  onSent: vi.fn(),
  draftIdRef: { current: "draft" },
  inFlightRef: { current: null },
  ...over,
});
beforeEach(() => {
  send.mockReset();
  remove.mockClear();
});
for (const value of [
  {
    status: "needs_review",
    deliveryOutcome: {
      state: "partial",
      accepted: ["customer@example.com"],
      rejected: ["other@example.com"],
    },
  },
  { status: "needs_review", deliveryOutcome: { state: "unknown" } },
  { status: "needs_review", deliveryOutcome: { state: "accepted" } },
  { status: "pending" },
  { status: "sending" },
  { status: "scheduled" },
  { status: "sent", sentCopy: { state: "failed", folderPath: "Sent" } },
  { status: "failed", deliveryOutcome: { state: "rejected" } },
] satisfies SendEmailOutcome[])
  it(`retains the draft and exposes structured review for ${JSON.stringify(value)}`, async () => {
    send.mockResolvedValue({ ok: true, value });
    const setOutcome = vi.fn();
    const d = deps({ setOutcome });
    await buildSendHandlers(d).handleSend();
    expect(setOutcome).toHaveBeenCalledWith(value);
    expect(d.resetDraft).not.toHaveBeenCalled();
    expect(d.onSent).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(d.setSending).toHaveBeenLastCalledWith(false);
  });
it("reuses a persisted intent across repeated status checks and handler rebuilds", async () => {
  send.mockResolvedValue({
    ok: true,
    value: { status: "needs_review", deliveryOutcome: { state: "unknown" } },
  });
  const idempotencyKeyRef = { current: "9d65da88-eae5-4f81-a674-d3f52fcb03d9" };
  await buildSendHandlers(deps({ idempotencyKeyRef, setOutcome: vi.fn() })).handleSend();
  await buildSendHandlers(deps({ idempotencyKeyRef, setOutcome: vi.fn() })).handleSend();
  expect(
    send.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey),
  ).toEqual([idempotencyKeyRef.current, idempotencyKeyRef.current]);
});
it("persists the current draft before the first send and stops when saving fails", async () => {
  send.mockResolvedValue({ ok: true, value: { status: "sent" } });
  const beforeSend = vi.fn(() => Promise.resolve(false));
  const d = deps({ beforeSend });
  await buildSendHandlers(d).handleSend();
  expect(beforeSend).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
  expect(d.resetDraft).not.toHaveBeenCalled();
  expect(d.setSending).toHaveBeenLastCalledWith(false);
});
it("preserves the existing Gmail success workflow", async () => {
  send.mockResolvedValue({ ok: true, value: { status: "sent", messageId: "message" } });
  const d = deps({ setOutcome: vi.fn() });
  await buildSendHandlers(d).handleSend();
  expect(d.resetDraft).toHaveBeenCalledOnce();
  expect(d.onSent).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledOnce();
});
