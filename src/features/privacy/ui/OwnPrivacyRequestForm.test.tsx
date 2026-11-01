// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { sessionRecordingOptions } from "@/features/observability/replayMasking";
import {
  fill,
  labels,
  PRIVATE,
  RECEIPT_ID,
  receipt,
  send,
  show,
  status,
} from "./OwnPrivacyRequestFormTestKit";

const mocks = vi.hoisted(() => ({ create: vi.fn(), workflow: vi.fn(), csrf: vi.fn() }));
vi.mock("../requestActions", () => ({ createOwnPrivacyRequestAction: mocks.create }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: mocks.csrf }));
vi.mock("@/features/auth/ui/workflowRequest", () => ({ workflowAction: mocks.workflow }));
vi.mock("@/features/auth/ui/useAccountStatus", () => ({
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: false } }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.csrf.mockReturnValue("csrf");
  mocks.create.mockResolvedValue({ ok: true, value: receipt });
  mocks.workflow.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

test.each(["en", "de", "fa"] as const)(
  "localizes request fields, direction and minimal receipt in %s",
  async (locale) => {
    const L = labels[locale];
    const { onReceived } = show(locale);
    expect(screen.getByRole("heading", { name: L.title })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: L.kind })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    fill(locale);
    send(locale);
    await screen.findByText(L.received);
    expect(onReceived).toHaveBeenCalledWith(receipt);
    expect(mocks.create).toHaveBeenCalledWith(
      "csrf",
      {
        intakeKey: expect.any(String),
        kind: "access",
        locale,
        summary: PRIVATE,
      },
      status.user.id,
    );
    expect(screen.getByText(RECEIPT_ID)).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(RECEIPT_ID).tagName).toBe("BDI");
    expect(screen.queryByLabelText(L.summary)).not.toBeInTheDocument();
    const date = screen.getByRole("time");
    expect(date).toHaveAttribute("dateTime", receipt.receivedAt.toISOString());
    if (locale === "fa") expect(date.textContent).toMatch(/۱۴۰۵|فروردین/);
  },
);

test.each(["", "   ", "x".repeat(4001)])(
  "validates summary before transport and retains it",
  (summary) => {
    show();
    fireEvent.change(screen.getByLabelText(labels.en.summary), { target: { value: summary } });
    send();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a request of 1 to 4,000 characters.",
    );
    expect(screen.getByLabelText(labels.en.summary)).toHaveValue(summary);
    expect(mocks.create).not.toHaveBeenCalled();
  },
);

test("pending disables edits and duplicate submits while one request is in flight", async () => {
  let settle: (value: unknown) => void = () => undefined;
  mocks.create.mockReturnValue(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  show();
  fill();
  send();
  expect(screen.getByRole("button", { name: "Sending request…" })).toBeDisabled();
  expect(screen.getByLabelText(labels.en.summary)).toBeDisabled();
  expect(screen.getByRole("combobox", { name: labels.en.kind })).toBeDisabled();
  fireEvent.submit(screen.getByRole("form", { name: labels.en.title }));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  settle({ ok: true, value: receipt });
  await screen.findByText(labels.en.received);
});

test("an uncertain transport outcome freezes the exact intent for a manual retry with a refreshed CSRF token", async () => {
  mocks.create.mockRejectedValueOnce(new Error("PRIVATE-driver-details"));
  show();
  fill();
  send();
  await screen.findByRole("button", { name: labels.en.retry });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Receipt is not confirmed. Retry the same request; do not create another one.",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE-driver-details");
  expect(screen.getByLabelText(labels.en.summary)).toBeDisabled();
  const first: unknown = mocks.create.mock.calls[0]?.[1];
  mocks.csrf.mockReturnValue("new-csrf");
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  await screen.findByText(labels.en.received);
  expect(mocks.create).toHaveBeenNthCalledWith(2, "new-csrf", first, status.user.id);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});

test("fresh authentication uses the existing inline flow and preserves text and logical intent without auto-resubmitting", async () => {
  mocks.create.mockResolvedValueOnce({ ok: false, error: "fresh_auth_required" });
  const { refreshSecurity } = show();
  fill();
  send();
  await screen.findByLabelText("Current password");
  expect(screen.getByLabelText(labels.en.summary)).toHaveValue(PRIVATE);
  expect(screen.getByLabelText(labels.en.summary)).toBeDisabled();
  const first: unknown = mocks.create.mock.calls[0]?.[1];
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "private-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm identity" }));
  await waitFor(() => expect(refreshSecurity).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledTimes(1);
  fireEvent.click(await screen.findByRole("button", { name: labels.en.retry }));
  await screen.findByText(labels.en.received);
  expect(mocks.create).toHaveBeenNthCalledWith(2, "csrf", first, status.user.id);
});

test.each([
  [
    "csrf_rejected",
    "The security check failed. Retry this request. If it still fails, ask the workspace operator for help.",
  ],
  ["forbidden", "This request is not currently permitted. Retry after your access is restored."],
  ["not_found", "This request is unavailable."],
  [
    "idempotency_conflict",
    "This retry does not match its original request. Ask the workspace operator for help.",
  ],
  [
    "storage_unavailable",
    "Receipt is not confirmed. Retry the same request; do not create another one.",
  ],
  ["stale_version", "The request changed. Refresh its status before continuing."],
  [
    "evidence_unavailable",
    "The verification evidence is unavailable. Ask the workspace operator for help.",
  ],
  ["case_not_mutable", "This request can no longer be changed."],
  [
    "request_failed",
    "Receipt is not confirmed. Retry the same request; do not create another one.",
  ],
])("renders bounded %s guidance and preserves the retry intent", async (error, message) => {
  mocks.create.mockResolvedValueOnce({ ok: false, error });
  show();
  fill();
  send();
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent(message);
  expect(screen.getByLabelText(labels.en.summary)).toHaveValue(PRIVATE);
  expect(screen.getByLabelText(labels.en.summary)).toBeDisabled();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

test("a server validation denial permits correction without automatically sending another request", async () => {
  mocks.create.mockResolvedValueOnce({ ok: false, error: "invalid_input" });
  show();
  fill();
  send();
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a request of 1 to 4,000 characters.");
  await waitFor(() => expect(screen.getByLabelText(labels.en.summary)).not.toBeDisabled(), {
    timeout: 1000,
  });
  expect(screen.getByLabelText(labels.en.summary)).toHaveValue(PRIVATE);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

test("privacy drafts, confirmation inputs, errors and receipts stay inside the replay and autocapture exclusion", async () => {
  mocks.create.mockResolvedValueOnce({ ok: false, error: "fresh_auth_required" });
  const { refreshSecurity } = show();
  const selector = `${sessionRecordingOptions.blockSelector}.ph-no-capture`;
  const card = screen.getByRole("heading", { name: labels.en.title }).closest(selector);
  expect(card).not.toBeNull();
  fill();
  expect(screen.getByLabelText(labels.en.summary).closest(selector)).toBe(card);
  send();
  const password = await screen.findByLabelText("Current password");
  fireEvent.change(password, { target: { value: "PRIVATE-confirmation-sentinel" } });
  expect(password.closest(selector)).not.toBeNull();
  expect(card).toContainElement(password);
  expect(screen.getByRole("alert").closest(selector)).toBe(card);
  fireEvent.click(screen.getByRole("button", { name: "Confirm identity" }));
  await waitFor(() => expect(refreshSecurity).toHaveBeenCalledOnce());
  const retry = await screen.findByRole("button", { name: labels.en.retry });
  await waitFor(() => expect(retry).not.toBeDisabled(), { timeout: 1000 });
  fireEvent.click(retry);
  expect((await screen.findByText(RECEIPT_ID)).closest(selector)).toBe(card);
});

test("portaled privacy request kinds carry both telemetry exclusions outside the form", () => {
  show();
  const form = screen.getByRole("form", { name: labels.en.title });
  fireEvent.click(screen.getByRole("combobox", { name: labels.en.kind }));
  const option = screen.getByRole("option", { name: "Erase personal data" });
  expect(form).not.toContainElement(option);
  expect(option.closest(`${sessionRecordingOptions.blockSelector}.ph-no-capture`)).not.toBeNull();
});
