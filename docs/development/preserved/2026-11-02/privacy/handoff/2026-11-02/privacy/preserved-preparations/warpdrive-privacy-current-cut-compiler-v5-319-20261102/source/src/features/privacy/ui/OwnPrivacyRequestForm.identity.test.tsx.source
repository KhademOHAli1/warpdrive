// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { err, ok } from "@/types/result";
import {
  fill,
  labels,
  OwnPrivacyRequestForm,
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

beforeEach(() => {
  vi.resetAllMocks();
  mocks.csrf.mockReturnValue("csrf");
  mocks.create.mockResolvedValue({ ok: true, value: receipt });
  mocks.workflow.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

test("account change clears and blocks the private draft before another action", async () => {
  mocks.create.mockResolvedValueOnce({ ok: false, error: "fresh_auth_required" });
  const { view, refreshSecurity, onReceived } = show();
  fill();
  send();
  await screen.findByRole("button", { name: labels.en.retry });
  view.rerender(
    <LocaleProvider locale="en">
      <OwnPrivacyRequestForm
        securityStatus={{
          ...status,
          user: { ...status.user, id: "00000000-0000-4000-8000-000000000002" },
        }}
        refreshSecurity={refreshSecurity}
        onReceived={onReceived}
      />
    </LocaleProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your signed-in account changed. The draft was cleared. Reload to start a request for the current account.",
  );
  expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument();
  expect(screen.queryByText(PRIVATE)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: labels.en.retry })).not.toBeInTheDocument();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

test("retry checks active identity before sending and never transfers a draft to a different requester", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Synthetic disconnected transport"));
  const { refreshSecurity } = show();
  fill();
  send();
  await screen.findByRole("button", { name: labels.en.retry });
  refreshSecurity.mockResolvedValueOnce(
    ok({
      ...status,
      fresh: true,
      user: { ...status.user, id: "00000000-0000-4000-8000-000000000002" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  await waitFor(() => expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument());
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(refreshSecurity).toHaveBeenCalledWith(expect.any(AbortSignal));
});

test("an in-flight result cannot publish a prior account's receipt after an account change", async () => {
  let settle: (value: unknown) => void = () => undefined;
  mocks.create.mockReturnValue(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  const { view, refreshSecurity, onReceived } = show();
  fill();
  send();
  view.rerender(
    <LocaleProvider locale="en">
      <OwnPrivacyRequestForm
        securityStatus={{
          ...status,
          user: { ...status.user, id: "00000000-0000-4000-8000-000000000002" },
        }}
        refreshSecurity={refreshSecurity}
        onReceived={onReceived}
      />
    </LocaleProvider>,
  );
  settle({ ok: true, value: receipt });
  await waitFor(() => expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument());
  expect(onReceived).not.toHaveBeenCalled();
  expect(screen.queryByText(RECEIPT_ID)).not.toBeInTheDocument();
});

test("a server requester change clears the private draft even if current props have not refreshed", async () => {
  mocks.create.mockResolvedValueOnce({ ok: false, error: "requester_changed" });
  show();
  fill();
  send();
  await waitFor(() => expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument());
  expect(screen.getByRole("alert")).toHaveTextContent("Your signed-in account changed.");
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

test("confirmed signed-out status clears a draft instead of submitting it after retry", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Synthetic disconnected transport"));
  const { refreshSecurity } = show();
  fill();
  send();
  await screen.findByRole("button", { name: labels.en.retry });
  refreshSecurity.mockResolvedValueOnce(ok(null));
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  await waitFor(() => expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument());
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

test("transient status refresh failure preserves the frozen draft without sending it", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Synthetic disconnected transport"));
  const { refreshSecurity } = show();
  fill();
  send();
  await screen.findByRole("button", { name: labels.en.retry });
  refreshSecurity.mockRejectedValueOnce(new Error("PRIVATE-status-details"));
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  await waitFor(() => expect(refreshSecurity).toHaveBeenCalledOnce());
  expect(await screen.findByRole("alert")).not.toHaveTextContent("PRIVATE-status-details");
  expect(screen.getByLabelText(labels.en.summary)).toHaveValue(PRIVATE);
  expect(screen.getByLabelText(labels.en.summary)).toBeDisabled();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

test("same-user nonfresh status prompts confirmation before retry without resubmitting", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Synthetic disconnected transport"));
  const { refreshSecurity } = show();
  fill();
  send();
  await screen.findByRole("button", { name: labels.en.retry });
  refreshSecurity.mockResolvedValueOnce(ok(status));
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  await screen.findByLabelText("Current password");
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

test("an unavailable Result preserves the frozen intent and a recovered Result resumes only its explicit retry", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Synthetic disconnected transport"));
  const { refreshSecurity } = show();
  fill();
  send();
  await screen.findByRole("button", { name: labels.en.retry });
  const first: unknown = mocks.create.mock.calls[0]?.[1];
  refreshSecurity
    .mockResolvedValueOnce(err("unavailable"))
    .mockResolvedValueOnce(ok({ ...status, fresh: true }));
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  await waitFor(() => expect(refreshSecurity).toHaveBeenCalledOnce());
  expect(await screen.findByRole("button", { name: labels.en.retry })).not.toBeDisabled();
  expect(screen.getByLabelText(labels.en.summary)).toHaveValue(PRIVATE);
  expect(screen.getByLabelText(labels.en.summary)).toBeDisabled();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create).toHaveBeenNthCalledWith(2, "csrf", first, status.user.id);
  await screen.findByText(labels.en.received);
});

test("an account switch after status resolution aborts before the action argument is evaluated", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Synthetic disconnected transport"));
  const { refreshSecurity, view, onReceived } = show();
  fill();
  send();
  await screen.findByRole("button", { name: labels.en.retry });
  let settle: (value: unknown) => void = () => undefined;
  refreshSecurity.mockReturnValueOnce(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: labels.en.retry }));
  const signal: unknown = refreshSecurity.mock.calls[0]?.[0];
  let afterAbort: boolean | undefined;
  mocks.create.mockImplementationOnce(() => {
    afterAbort = signal instanceof AbortSignal && signal.aborted;
    return Promise.resolve({ ok: true, value: receipt });
  });
  await act(() => {
    settle(ok({ ...status, fresh: true }));
    // Account changes between the status continuation and the create-action continuation.
    queueMicrotask(() =>
      queueMicrotask(() => {
        view.rerender(
          <LocaleProvider locale="en">
            <OwnPrivacyRequestForm
              securityStatus={{
                ...status,
                user: { ...status.user, id: "00000000-0000-4000-8000-000000000002" },
              }}
              refreshSecurity={refreshSecurity}
              onReceived={onReceived}
            />
          </LocaleProvider>,
        );
      }),
    );
    return Promise.resolve();
  });
  await waitFor(() => expect(screen.queryByLabelText(labels.en.summary)).not.toBeInTheDocument());
  expect({ calls: mocks.create.mock.calls.length, afterAbort }).toEqual({
    calls: 1,
    afterAbort: undefined,
  });
  expect(onReceived).not.toHaveBeenCalled();
});
