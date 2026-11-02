// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ok } from "@/types/result";
import {
  CASE_ID,
  confirm,
  currentCase,
  deferred,
  labels,
  loaded,
  mocks,
  OTHER_CASE_ID,
  refresh,
  security,
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

const otherSecurity = {
  ...security,
  user: { ...security.user, id: "00000000-0000-4000-8000-000000000002" },
};

test("an account change fences an old read permanently for this mounted view", async () => {
  const pending = deferred<ReturnType<typeof ok<typeof currentCase>>>();
  mocks.read.mockReturnValueOnce(pending.promise);
  const { rerender } = showCase();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce(), { timeout: 1000 });
  rerender(otherSecurity);
  expect(await screen.findByRole("alert", {}, { timeout: 1000 })).toHaveTextContent(
    "Your signed-in account changed.",
  );
  await settle(pending, ok(currentCase));
  rerender(security);
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: labels.en.confirm })).not.toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.verify).not.toHaveBeenCalled();
});

test("authoritative sign-out clears the private case and blocks confirmation", async () => {
  const { refreshSecurity } = showCase();
  await loaded();
  refreshSecurity.mockResolvedValueOnce(ok(null));
  refresh();
  await screen.findByText("Sign in again to continue.", {}, { timeout: 1000 });
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: labels.en.confirm })).not.toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.verify).not.toHaveBeenCalled();
});

test("changing the opaque case reference drops the prior response before loading the next one", async () => {
  const pending = deferred<ReturnType<typeof ok<typeof currentCase>>>();
  mocks.read
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(ok({ ...currentCase, id: OTHER_CASE_ID }));
  const { rerender } = showCase();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce(), { timeout: 1000 });
  rerender(security, OTHER_CASE_ID);
  await screen.findByText(OTHER_CASE_ID, {}, { timeout: 1000 });
  await settle(pending, ok(currentCase));
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(screen.getByText(OTHER_CASE_ID)).toBeInTheDocument();
  expect(mocks.read).toHaveBeenLastCalledWith("csrf", { caseId: OTHER_CASE_ID });
});

test("a late confirmation cannot publish its notice or reread an old case after reference change", async () => {
  const pending = deferred<ReturnType<typeof ok<typeof currentCase>>>();
  mocks.verify.mockReturnValueOnce(pending.promise);
  const { rerender } = showCase();
  await loaded();
  confirm();
  await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce(), { timeout: 1000 });
  mocks.read.mockResolvedValueOnce(ok({ ...currentCase, id: OTHER_CASE_ID }));
  rerender(security, OTHER_CASE_ID);
  await screen.findByText(OTHER_CASE_ID, {}, { timeout: 1000 });
  await settle(pending, ok({ ...currentCase, version: 4 }));
  expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

test("an account change while confirmation checks identity aborts before evaluating the action", async () => {
  const { rerender, refreshSecurity } = showCase();
  await loaded();
  const pending = deferred<ReturnType<typeof ok<typeof security>>>();
  refreshSecurity.mockReturnValueOnce(pending.promise);
  confirm();
  await waitFor(() => expect(refreshSecurity).toHaveBeenCalledOnce(), { timeout: 1000 });
  rerender(otherSecurity);
  await settle(pending, ok(security));
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(refreshSecurity.mock.calls[0]?.[0]).toMatchObject({ aborted: true });
});

test("unmount fences a confirmation result from issuing its follow-up read", async () => {
  const pending = deferred<ReturnType<typeof ok<typeof currentCase>>>();
  mocks.verify.mockReturnValueOnce(pending.promise);
  const { view } = showCase();
  await loaded();
  confirm();
  await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce(), { timeout: 1000 });
  view.unmount();
  await settle(pending, ok({ ...currentCase, version: 4 }));
  expect(mocks.read).toHaveBeenCalledOnce();
});
