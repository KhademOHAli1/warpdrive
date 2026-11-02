// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NextActionQueueInput, NextActionQueuePage } from "./next-action-queue/queueTypes";

const rpc = vi.hoisted(() => ({
  query:
    vi.fn<
      (
        input: NextActionQueueInput,
        options: { signal: AbortSignal },
      ) => Promise<NextActionQueuePage>
    >(),
}));
const preferenceAction = vi.hoisted(() => vi.fn<() => Promise<{ ok: boolean }>>());
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: preferenceAction }));
const utils = { client: { activities: { nextActionQueue: { query: rpc.query } } } };
vi.mock("@/lib/trpc-client", () => ({ trpc: { useUtils: () => utils } }));
vi.mock("./CalendarEventEditDialog", () => ({
  CalendarEventEditDialog: ({
    id,
    onSaved,
    onClose,
  }: {
    id: string;
    onSaved: () => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={`Edit ${id}`}>
      <button type="button" onClick={onSaved}>
        Save existing activity
      </button>
      <button type="button" onClick={onClose}>
        Close editor
      </button>
    </div>
  ),
}));
vi.mock("./AddActivityModal", () => ({
  AddActivityModal: ({
    dealId,
    onCreated,
    onClose,
  }: {
    dealId: string;
    onCreated: () => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={`Schedule ${dealId}`}>
      <button type="button" onClick={onCreated}>
        Create linked activity
      </button>
      <button type="button" onClick={onClose}>
        Close scheduler
      </button>
    </div>
  ),
}));

import { queuePage } from "./NextActionQueue.test-support";
import { deferred, renderQueueClient } from "./NextActionQueueClient.test.support";

configure({ asyncUtilTimeout: 750 });
beforeEach(() => {
  rpc.query.mockReset();
  preferenceAction.mockReset().mockResolvedValue({ ok: true });
});
afterEach(cleanup);

async function loaded() {
  await screen.findByText("پیگیری / Follow-up");
}

function chooseAll() {
  fireEvent.click(screen.getByRole("combobox", { name: "Work shown" }));
  fireEvent.click(screen.getByRole("option", { name: "All I can access" }));
}

test("starts a mine/25/0 authorized read and never wires a quick completion", async () => {
  const read = deferred<NextActionQueuePage>();
  rpc.query.mockReturnValueOnce(read.promise);
  renderQueueClient();
  expect(screen.getByRole("status")).toHaveTextContent("Updating next actions");
  await waitFor(() => expect(rpc.query).toHaveBeenCalledOnce());
  expect(rpc.query).toHaveBeenCalledWith(
    { scope: "mine", limit: 25, offset: 0 },
    { signal: expect.any(AbortSignal) },
  );
  await act(async () => {
    read.resolve(queuePage());
    await read.promise;
  });
  await loaded();
  expect(screen.getByText("1 overdue activity")).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Mark complete:/ })).not.toBeInTheDocument();
});

test("scope changes hide old rows and counts, reset paging and discard late broader reads", async () => {
  const broader = deferred<NextActionQueuePage>();
  const current = deferred<NextActionQueuePage>();
  rpc.query.mockResolvedValueOnce({ ...queuePage(), total: 60 });
  rpc.query.mockReturnValueOnce(broader.promise).mockReturnValueOnce(current.promise);
  renderQueueClient();
  await loaded();
  chooseAll();
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: "Work shown" }));
  fireEvent.click(screen.getByRole("option", { name: "My work" }));
  await act(async () => {
    broader.resolve({ ...queuePage(), scope: "all-permitted" });
    await broader.promise;
  });
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  await act(async () => {
    current.resolve({ ...queuePage(), readId: "mine-again" });
    await current.promise;
  });
  await loaded();
  expect(rpc.query.mock.calls.at(-1)?.[0]).toEqual({ scope: "mine", limit: 25, offset: 0 });
  expect(rpc.query.mock.calls[1]?.[1].signal.aborted).toBe(true);
});

test("pagination starts a distinct read and a scope change always returns to the first page", async () => {
  const later = deferred<NextActionQueuePage>();
  rpc.query.mockResolvedValueOnce({ ...queuePage(), total: 60 }).mockReturnValueOnce(later.promise);
  rpc.query.mockResolvedValueOnce({ ...queuePage(), scope: "all-permitted", readId: "all-first" });
  renderQueueClient();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  await waitFor(() => expect(rpc.query.mock.calls.at(-1)?.[0].offset).toBe(25));
  chooseAll();
  await loaded();
  expect(rpc.query.mock.calls.at(-1)?.[0]).toEqual({
    scope: "all-permitted",
    limit: 25,
    offset: 0,
  });
  await act(async () => {
    later.resolve({ ...queuePage(), offset: 25, readId: "old-page" });
    await later.promise;
  });
  expect(screen.getByRole("combobox", { name: "Work shown" })).toHaveTextContent(
    "All I can access",
  );
});

test("a read failure hides prior work and explicit refresh starts a new request", async () => {
  rpc.query.mockResolvedValueOnce(queuePage());
  rpc.query.mockRejectedValueOnce(new Error("PRIVATE backend message"));
  rpc.query.mockResolvedValueOnce({ ...queuePage(), scope: "all-permitted", readId: "recovered" });
  renderQueueClient();
  await loaded();
  chooseAll();
  await screen.findByRole("alert");
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain("PRIVATE");
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  await loaded();
  expect(rpc.query).toHaveBeenCalledTimes(3);
});

test("an editor save cancels pre-save reads and accepts only the newly started read", async () => {
  const beforeSave = deferred<NextActionQueuePage>();
  const afterSave = deferred<NextActionQueuePage>();
  rpc.query.mockResolvedValueOnce(queuePage()).mockReturnValueOnce(beforeSave.promise);
  rpc.query.mockReturnValueOnce(afterSave.promise);
  const view = renderQueueClient();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: /^Edit activity:/ }));
  expect(screen.getByRole("dialog", { name: "Edit activity-1" })).toBeVisible();
  act(() => {
    void view.client.refetchQueries({ type: "active" });
  });
  await waitFor(() => expect(rpc.query).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Save existing activity" }));
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
  await waitFor(() => expect(rpc.query).toHaveBeenCalledTimes(3));
  expect(rpc.query.mock.calls[1]?.[1].signal.aborted).toBe(true);
  await act(async () => {
    beforeSave.resolve({ ...queuePage(), readId: "late-before-save" });
    await beforeSave.promise;
  });
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  await act(async () => {
    afterSave.resolve({ ...queuePage(), readId: "after-save", rows: [], total: 0 });
    await afterSave.promise;
  });
  await screen.findByText("No next actions in this view.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("schedules through the existing deal dialog and refreshes after a real creation callback", async () => {
  const refreshed = deferred<NextActionQueuePage>();
  rpc.query.mockResolvedValueOnce(queuePage()).mockReturnValueOnce(refreshed.promise);
  renderQueueClient();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: /^Schedule activity:/ }));
  expect(screen.getByRole("dialog", { name: "Schedule deal-1" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Create linked activity" }));
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  await act(async () => {
    refreshed.resolve({ ...queuePage(), readId: "created" });
    await refreshed.promise;
  });
  await loaded();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("saved timezone changes hide old results until a new server read succeeds", async () => {
  const updated = deferred<NextActionQueuePage>();
  rpc.query.mockResolvedValueOnce(queuePage()).mockReturnValueOnce(updated.promise);
  const view = renderQueueClient();
  await loaded();
  view.changeTimeZone("Asia/Tehran");
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
  await act(async () => {
    updated.resolve({ ...queuePage(), readId: "new-preferences" });
    await updated.promise;
  });
  await loaded();
  expect(rpc.query).toHaveBeenCalledTimes(2);
});

test.each([true, false])(
  "an optimistic preference save hides work until preferences settle (saved=%s)",
  async (saved) => {
    const saving = deferred<{ ok: boolean }>();
    const settledRead = deferred<NextActionQueuePage>();
    preferenceAction.mockReturnValueOnce(saving.promise);
    rpc.query.mockResolvedValueOnce(queuePage()).mockReturnValueOnce(settledRead.promise);
    renderQueueClient();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Save account timezone" }));
    expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
    expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
    await waitFor(() => expect(preferenceAction).toHaveBeenCalledOnce());
    expect(rpc.query).toHaveBeenCalledTimes(1);
    await act(async () => {
      saving.resolve({ ok: saved });
      await saving.promise;
    });
    await waitFor(() => expect(rpc.query).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
    await act(async () => {
      settledRead.resolve({
        ...queuePage(),
        readId: "preferences-confirmed",
        timeZone: saved ? "Asia/Tehran" : "Europe/Berlin",
      });
      await settledRead.promise;
    });
    await loaded();
  },
);

test("actor changes discard old reads, rows and dialogs rather than reusing another account cache", async () => {
  const other = deferred<NextActionQueuePage>();
  rpc.query.mockResolvedValueOnce(queuePage()).mockReturnValueOnce(other.promise);
  const view = renderQueueClient();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: /^Schedule activity:/ }));
  view.changeUser("user-2");
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => {
    other.resolve({ ...queuePage(), readId: "other-actor", rows: [], total: 0 });
    await other.promise;
  });
  await screen.findByText("No next actions in this view.");
  expect(rpc.query).toHaveBeenCalledTimes(2);
});

test("an empty actor fails closed without a query", () => {
  renderQueueClient("");
  expect(rpc.query).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Next actions could not be loaded");
});
