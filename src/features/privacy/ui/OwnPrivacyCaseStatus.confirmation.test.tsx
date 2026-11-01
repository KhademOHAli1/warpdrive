// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { err, ok } from "@/types/result";
import {
  CASE_ID,
  confirm,
  currentCase,
  deferred,
  labels,
  loaded,
  mocks,
  refresh,
  settle,
  showCase,
} from "./__fixtures__/OwnPrivacyCaseStatusTestKit";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(ok(currentCase));
  mocks.verify.mockResolvedValue(ok({ ...currentCase, version: 4 }));
  mocks.workflow.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

test.each(["en", "de", "fa"] as const)(
  "%s own-account confirmation rereads current status instead of publishing an old receipt as current",
  async (locale) => {
    mocks.read.mockResolvedValueOnce(ok(currentCase)).mockResolvedValueOnce(
      ok({
        ...currentCase,
        status: "under_review",
        version: 8,
      }),
    );
    const { refreshSecurity } = showCase(locale);
    await loaded(locale);
    expect(mocks.verify).not.toHaveBeenCalled();
    confirm(locale);
    expect(
      await screen.findByText(labels[locale].recorded, {}, { timeout: 1000 }),
    ).toBeInTheDocument();
    const currentStatus = { en: "Under review", de: "In Prüfung", fa: "در حال بررسی" };
    expect(
      await screen.findByText(currentStatus[locale], {}, { timeout: 1000 }),
    ).toBeInTheDocument();
    expect(refreshSecurity).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(mocks.verify).toHaveBeenCalledWith("csrf", {
      caseId: CASE_ID,
      expectedVersion: 3,
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: labels[locale].confirm })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Identity verified|Export ready/u);
  },
);

test("an uncertain confirmation retains the exact command even after a newer status read", async () => {
  mocks.verify.mockRejectedValueOnce(new Error("PRIVATE-lost-acknowledgement"));
  const { refreshSecurity } = showCase();
  await loaded();
  confirm();
  const retry = await screen.findByRole("button", { name: labels.en.retry }, { timeout: 1000 });
  const command: unknown = mocks.verify.mock.calls[0]?.[1];
  expect(document.body).not.toHaveTextContent("PRIVATE-lost-acknowledgement");
  expect(mocks.verify).toHaveBeenCalledTimes(1);
  mocks.read.mockResolvedValueOnce(ok({ ...currentCase, version: 12 }));
  refresh();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2), { timeout: 1000 });
  await waitFor(() => expect(retry).not.toBeDisabled(), { timeout: 1000 });
  fireEvent.click(retry);
  await screen.findByText(labels.en.recorded, {}, { timeout: 1000 });
  expect(mocks.verify).toHaveBeenNthCalledWith(2, "csrf", command);
  expect(refreshSecurity).toHaveBeenCalledTimes(3);
});

test("confirmation is offered for verification-needed but never for other current states", async () => {
  mocks.read.mockResolvedValueOnce(ok({ ...currentCase, status: "verification_needed" }));
  showCase();
  expect(
    await screen.findByRole("button", { name: labels.en.confirm }, { timeout: 1000 }),
  ).toBeInTheDocument();
  cleanup();
  for (const status of [
    "under_review",
    "action_approved",
    "running",
    "needs_attention",
    "refused",
    "response_ready",
    "responded",
    "closed",
    "cancelled",
    "future_unknown_status",
  ]) {
    mocks.read.mockResolvedValueOnce(ok({ ...currentCase, status }));
    showCase();
    await screen.findByText(CASE_ID, {}, { timeout: 1000 });
    expect(screen.queryByRole("button", { name: labels.en.confirm })).not.toBeInTheDocument();
    expect(screen.queryByText(status)).not.toBeInTheDocument();
    cleanup();
  }
  expect(mocks.verify).not.toHaveBeenCalled();
});

test("one pending confirmation prevents double dispatch and reads only after its result", async () => {
  const pending = deferred<ReturnType<typeof ok<typeof currentCase>>>();
  mocks.verify.mockReturnValueOnce(pending.promise);
  showCase();
  await loaded();
  confirm();
  await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce(), { timeout: 1000 });
  const action = screen.queryByRole("button", { name: labels.en.confirm });
  if (action !== null) fireEvent.click(action);
  expect(mocks.verify).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledOnce();
  await settle(pending, ok({ ...currentCase, version: 4 }));
  await screen.findByText(labels.en.recorded, {}, { timeout: 1000 });
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

test("an unavailable same-account check preserves the case without sending a confirmation", async () => {
  const { refreshSecurity } = showCase();
  await loaded();
  refreshSecurity.mockResolvedValueOnce(err("unavailable"));
  confirm();
  await waitFor(() => expect(refreshSecurity).toHaveBeenCalledOnce(), { timeout: 1000 });
  expect(screen.getByText(CASE_ID)).toBeInTheDocument();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert", {}, { timeout: 1000 })).not.toHaveTextContent("PRIVATE-");
});
