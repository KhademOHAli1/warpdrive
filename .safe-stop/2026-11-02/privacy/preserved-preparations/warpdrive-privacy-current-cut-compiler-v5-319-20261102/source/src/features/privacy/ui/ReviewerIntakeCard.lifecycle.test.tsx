// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { err, ok } from "@/types/result";
import {
  CASE_ID,
  deferred,
  labels,
  load,
  mocks,
  OTHER_ID,
  queue,
  reset,
  security,
  show,
} from "./ReviewerIntakeTestKit";

beforeEach(reset);
afterEach(cleanup);

test("an account switch clears rows and a late queue response cannot restore them", async () => {
  const subject = show();
  await load();
  const late = deferred<{ ok: true; value: ReturnType<typeof queue> }>();
  mocks.list.mockReturnValueOnce(late.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2), { timeout: 1000 });
  subject.rerender({ ...security, user: { ...security.user, id: OTHER_ID } });
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  await act(async () => {
    late.resolve(ok(queue()));
    await late.promise;
  });
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your signed-in account changed. Reload privacy settings to continue.",
  );
  expect(mocks.claim).not.toHaveBeenCalled();
});

test("current forbidden response removes cached queue rows without invoking a claim", async () => {
  show();
  await load();
  mocks.list.mockResolvedValueOnce(err("forbidden"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
  await screen.findByText(
    "These requests are unavailable for your account.",
    {},
    { timeout: 1000 },
  );
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(mocks.claim).not.toHaveBeenCalled();
});

test("stale authentication prevents loading before native queue authority is consulted", async () => {
  const subject = show("en", { ...security, fresh: false });
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(
    "Confirm your identity before loading or assigning requests.",
    {},
    { timeout: 1000 },
  );
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(subject.refreshSecurity).toHaveBeenCalledWith(expect.any(AbortSignal));
});

test("unmounting suppresses a late queue result without an automatic mutation", async () => {
  const late = deferred<{ ok: true; value: ReturnType<typeof queue> }>();
  mocks.list.mockReturnValueOnce(late.promise);
  const subject = show();
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1), { timeout: 1000 });
  const signal = subject.refreshSecurity.mock.calls[0]?.[0];
  expect(signal).toBeInstanceOf(AbortSignal);
  subject.view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    late.resolve(ok(queue()));
    await late.promise;
  });
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(mocks.claim).not.toHaveBeenCalled();
});
