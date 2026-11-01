// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { err, ok } from "@/types/result";
import {
  deferred,
  draft,
  focusWorkspace,
  labels,
  PRIVATE,
  RECEIPT_ID,
  receipt,
  type SecurityResult,
  settle,
  showWorkspace,
  status,
  workspaceLabels,
} from "./PersonalPrivacyWorkspaceTestKit";

const mocks = vi.hoisted(() => ({ load: vi.fn(), create: vi.fn(), workflow: vi.fn() }));
vi.mock("./loadOwnPrivacySecurity", () => ({ loadOwnPrivacySecurity: mocks.load }));
vi.mock("../requestActions", () => ({ createOwnPrivacyRequestAction: mocks.create }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/auth/ui/workflowRequest", () => ({ workflowAction: mocks.workflow }));
vi.mock("@/features/auth/ui/useAccountStatus", () => ({
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: false } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(ok(status));
  mocks.create.mockResolvedValue({ ok: true, value: receipt });
  mocks.workflow.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("same-user focus and unavailable refreshes preserve the same private form without auto-submitting", async () => {
  showWorkspace();
  const input = await draft();
  mocks.load.mockResolvedValueOnce(ok({ ...status, fresh: true }));
  focusWorkspace();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(labels.en.summary)).toBe(input);
  expect(input).toHaveValue(PRIVATE);
  mocks.load.mockResolvedValueOnce(err("unavailable"));
  focusWorkspace();
  expect(await screen.findByRole("alert")).toHaveTextContent(workspaceLabels.en.unavailable);
  expect(screen.getByLabelText(labels.en.summary)).toBe(input);
  expect(input).toHaveValue(PRIVATE);
  fireEvent.click(screen.getByRole("button", { name: workspaceLabels.en.retry }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(4));
  expect(screen.getByLabelText(labels.en.summary)).toBe(input);
  expect(input).toHaveValue(PRIVATE);
  expect(mocks.create).not.toHaveBeenCalled();
});

test("hidden visibility events do not load, and a visible event refreshes without submitting", async () => {
  showWorkspace();
  const input = await draft();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(mocks.load).toHaveBeenCalledOnce();
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(input).toHaveValue(PRIVATE);
  expect(mocks.create).not.toHaveBeenCalled();
});

test("an account change unmounts the old draft and suppresses its late receipt even if the old user returns", async () => {
  const pending = deferred<{ ok: true; value: typeof receipt }>();
  mocks.create.mockReturnValueOnce(pending.promise);
  showWorkspace();
  await draft();
  fireEvent.click(screen.getByRole("button", { name: labels.en.submit }));
  mocks.load.mockResolvedValueOnce(
    ok({ ...status, user: { ...status.user, id: "00000000-0000-4000-8000-000000000002" } }),
  );
  focusWorkspace();
  await waitFor(() => expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument());
  expect(screen.getByRole("alert")).toHaveTextContent("Your signed-in account changed.");
  expect(screen.queryByText(PRIVATE)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Reload privacy settings" })).toHaveAttribute(
    "href",
    "/settings/privacy",
  );
  await settle(pending, { ok: true, value: receipt });
  focusWorkspace();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
  expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument();
  expect(screen.queryByText(RECEIPT_ID)).not.toBeInTheDocument();
  expect(mocks.create).toHaveBeenCalledOnce();
});

test("confirmed sign-out clears a mounted draft and offers only the fixed safe sign-in return", async () => {
  showWorkspace();
  await draft();
  mocks.load.mockResolvedValueOnce(ok(null));
  focusWorkspace();
  const link = await screen.findByRole("link", { name: workspaceLabels.en.signIn });
  expect(link).toHaveAttribute("href", "/login?returnTo=%2Fsettings%2Fprivacy");
  expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument();
  expect(screen.queryByText(PRIVATE)).not.toBeInTheDocument();
  expect(mocks.create).not.toHaveBeenCalled();
});

test("a superseded focus response cannot restore an expired session", async () => {
  showWorkspace();
  await draft();
  const old = deferred<SecurityResult>();
  mocks.load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(ok(null));
  focusWorkspace();
  focusWorkspace();
  await screen.findByRole("link", { name: workspaceLabels.en.signIn });
  expect(mocks.load.mock.calls[1]?.[0]).toMatchObject({ aborted: true });
  await settle(old, ok({ ...status, fresh: true }));
  expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: workspaceLabels.en.signIn })).toBeInTheDocument();
  expect(mocks.create).not.toHaveBeenCalled();
});

test("a superseded explicit form refresh cannot authorize a retry after a newer nonfresh same-user result", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Synthetic interrupted transport"));
  showWorkspace();
  await draft();
  fireEvent.click(screen.getByRole("button", { name: labels.en.submit }));
  await screen.findByRole("button", { name: labels.en.retry });
  const old = deferred<SecurityResult>();
  mocks.load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(ok(status));
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  focusWorkspace();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(mocks.load.mock.calls[1]?.[0]).toMatchObject({ aborted: true });
  await settle(old, ok({ ...status, fresh: true }));
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(screen.getByLabelText(labels.en.summary)).toHaveValue(PRIVATE);
  expect(screen.getByLabelText(labels.en.summary)).toBeDisabled();
});

test("enrollment offers existing Security in a safe new tab while preserving the parent draft", async () => {
  mocks.load.mockResolvedValue(ok({ ...status, hasPassword: false, needsEnrollment: true }));
  showWorkspace();
  const input = await draft();
  const link = screen.getByRole("link", { name: workspaceLabels.en.security });
  expect(link).toHaveAttribute("href", "/settings/security");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  focusWorkspace();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(labels.en.summary)).toBe(input);
  expect(input).toHaveValue(PRIVATE);
  expect(mocks.create).not.toHaveBeenCalled();
});

test("inline confirmation refreshes active status without auto-submitting, and explicit retry retains its intent", async () => {
  mocks.create.mockResolvedValueOnce({ ok: false, error: "fresh_auth_required" });
  showWorkspace();
  const input = await draft();
  fireEvent.click(screen.getByRole("button", { name: labels.en.submit }));
  const first: unknown = mocks.create.mock.calls[0]?.[1];
  const password = await screen.findByLabelText("Current password");
  fireEvent.change(password, { target: { value: "Synthetic password" } });
  mocks.load.mockResolvedValue(ok({ ...status, fresh: true }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm identity" }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(labels.en.summary)).toBe(input);
  expect(input).toHaveValue(PRIVATE);
  expect(mocks.create).toHaveBeenCalledOnce();
  fireEvent.click(await screen.findByRole("button", { name: labels.en.retry }));
  await screen.findByText(RECEIPT_ID);
  expect(mocks.load).toHaveBeenCalledTimes(3);
  expect(mocks.create).toHaveBeenNthCalledWith(2, "csrf", first, status.user.id);
});
