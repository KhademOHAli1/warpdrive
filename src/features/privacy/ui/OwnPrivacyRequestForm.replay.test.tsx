// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EventType, record, takeFullSnapshot } from "posthog-js/rrweb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sessionRecordingOptions } from "@/features/observability/replayMasking";
import {
  fill,
  labels,
  PRIVATE,
  RECEIPT_ID,
  receipt,
  send,
  show,
} from "./OwnPrivacyRequestFormTestKit";

const mocks = vi.hoisted(() => ({ create: vi.fn(), workflow: vi.fn() }));
vi.mock("../requestActions", () => ({ createOwnPrivacyRequestAction: mocks.create }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/auth/ui/workflowRequest", () => ({ workflowAction: mocks.workflow }));
vi.mock("@/features/auth/ui/useAccountStatus", () => ({
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: false } }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValueOnce({ ok: false, error: "fresh_auth_required" });
  mocks.create.mockResolvedValue({ ok: true, value: receipt });
  mocks.workflow.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

test("installed replay recorder excludes the real privacy card while retaining a public sibling", async () => {
  const publicControl = "PUBLIC-replay-control";
  render(<p>{publicControl}</p>);
  const { refreshSecurity } = show();
  fill();
  const snapshots: string[] = [];
  const stop = record({
    ...sessionRecordingOptions,
    blockClass: "ph-no-capture",
    emit(event) {
      if (event.type === EventType.FullSnapshot) snapshots.push(JSON.stringify(event));
    },
  });
  function snapshot() {
    const before = snapshots.length;
    takeFullSnapshot();
    expect(snapshots.length).toBeGreaterThan(before);
    const latest = snapshots.at(-1);
    expect(latest).toContain(publicControl);
    return latest;
  }
  try {
    expect(stop).toBeTypeOf("function");
    expect(snapshot()).not.toContain(PRIVATE);
    send();
    const password = await screen.findByLabelText("Current password");
    fireEvent.change(password, { target: { value: "PRIVATE-factor-sentinel" } });
    expect(snapshot()).not.toContain("PRIVATE-factor-sentinel");
    fireEvent.click(screen.getByRole("button", { name: "Confirm identity" }));
    await waitFor(() => expect(refreshSecurity).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole("button", { name: labels.en.retry }));
    await screen.findByText(RECEIPT_ID);
    expect(snapshot()).not.toContain(RECEIPT_ID);
  } finally {
    stop?.();
  }
});
