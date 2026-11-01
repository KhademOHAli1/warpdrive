// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sessionRecordingOptions } from "@/features/observability/replayMasking";
import { err, ok } from "@/types/result";
import {
  deferred,
  labels,
  type SecurityResult,
  settle,
  showWorkspace,
  status,
  workspaceLabels,
} from "./PersonalPrivacyWorkspaceTestKit";

const mocks = vi.hoisted(() => ({ load: vi.fn(), create: vi.fn() }));
vi.mock("./loadOwnPrivacySecurity", () => ({ loadOwnPrivacySecurity: mocks.load }));
vi.mock("../requestActions", () => ({ createOwnPrivacyRequestAction: mocks.create }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/auth/ui/useAccountStatus", () => ({
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: false } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(ok(status));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test.each(["en", "de", "fa"] as const)(
  "localizes the workspace heading, loading and unavailable state in %s",
  async (locale) => {
    const pending = deferred<SecurityResult>();
    mocks.load.mockReturnValueOnce(pending.promise);
    showWorkspace(locale);
    const L = workspaceLabels[locale];
    const heading = screen.getByRole("heading", { level: 1, name: L.title });
    expect(
      heading.closest(`${sessionRecordingOptions.blockSelector}.ph-no-capture`),
    ).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(L.loading);
    expect(document.documentElement).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce(), { timeout: 1000 });
    expect(mocks.load).toHaveBeenCalledWith(expect.any(AbortSignal));
    await settle(pending, err("unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent(L.unavailable);
    expect(screen.getByRole("button", { name: L.retry })).not.toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  },
);

test("unavailable initial status has one explicit bounded retry and never creates a request", async () => {
  const pending = deferred<SecurityResult>();
  mocks.load.mockResolvedValueOnce(err("unavailable")).mockReturnValueOnce(pending.promise);
  showWorkspace();
  await screen.findByRole("alert", {}, { timeout: 1000 });
  expect(mocks.load).toHaveBeenCalledOnce();
  const retry = screen.getByRole("button", { name: workspaceLabels.en.retry });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: workspaceLabels.en.retry })).toBeDisabled();
  await settle(pending, ok(status));
  expect(await screen.findByLabelText(labels.en.summary)).toBeInTheDocument();
  expect(mocks.create).not.toHaveBeenCalled();
});

test("authoritative expired session uses a fixed privacy return path without a private query", async () => {
  mocks.load.mockResolvedValueOnce(ok(null));
  showWorkspace();
  const link = await screen.findByRole(
    "link",
    { name: workspaceLabels.en.signIn },
    { timeout: 1000 },
  );
  expect(link).toHaveAttribute("href", "/login?returnTo=%2Fsettings%2Fprivacy");
  expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument();
  expect(link.closest(`${sessionRecordingOptions.blockSelector}.ph-no-capture`)).not.toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});

test("unmount aborts initial loading and removes active-status event listeners", async () => {
  const pending = deferred<SecurityResult>();
  mocks.load.mockReturnValueOnce(pending.promise);
  const view = showWorkspace();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce(), { timeout: 1000 });
  const signal: unknown = mocks.load.mock.calls[0]?.[0];
  view.unmount();
  expect(signal).toMatchObject({ aborted: true });
  fireEvent(window, new Event("focus"));
  fireEvent(document, new Event("visibilitychange"));
  await settle(pending, ok(status));
  expect(mocks.load).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
});
