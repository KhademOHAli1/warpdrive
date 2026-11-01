// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NextActionQueue, type QueueCompletionResult } from "./NextActionQueue";
import { queueProps } from "./NextActionQueue.test-support";

afterEach(cleanup);
const completeButton = () =>
  screen.getByRole("button", { name: "Mark complete: پیگیری / Follow-up" });

test("completion is done=true, blocks duplicates while pending and holds an acknowledged row until fresh read", async () => {
  let finish!: (result: QueueCompletionResult) => void;
  const completion = new Promise<QueueCompletionResult>((resolve) => {
    finish = resolve;
  });
  const onCompleteActivity = vi.fn(() => completion);
  const props = { ...queueProps(), onCompleteActivity };
  const view = render(<NextActionQueue {...props} />);
  fireEvent.click(completeButton());
  await waitFor(() => expect(completeButton()).toBeDisabled());
  fireEvent.click(completeButton());
  expect(onCompleteActivity).toHaveBeenCalledTimes(1);
  expect(onCompleteActivity).toHaveBeenCalledWith({ id: "activity-1", done: true });
  await act(async () => {
    finish({ ok: true, value: { id: "activity-1" } });
    await completion;
  });
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: "Mark complete: پیگیری / Follow-up" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Completion saved");
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
  view.rerender(<NextActionQueue {...props} page={{ ...props.page }} />);
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(onCompleteActivity).toHaveBeenCalledTimes(1);
  view.rerender(<NextActionQueue {...props} page={{ ...props.page, readId: "read-2" }} />);
  expect(completeButton()).toBeEnabled();
});

test("unknown completion needs a new authoritative read and explicit reviewed retry", async () => {
  const onCompleteActivity = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost response including private detail"))
    .mockResolvedValue({ ok: true, value: { id: "activity-1" } });
  const props = { ...queueProps(), onCompleteActivity };
  const view = render(<NextActionQueue {...props} />);
  fireEvent.click(completeButton());
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Completion could not be confirmed"),
  );
  expect(document.body.textContent).not.toContain("private detail");
  expect(completeButton()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
  view.rerender(
    <NextActionQueue
      {...props}
      page={{ ...props.page, rows: [...props.page.rows], asOf: "2026-11-01T10:02:00Z" }}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Complete using refreshed activity" }),
  ).not.toBeInTheDocument();
  view.rerender(<NextActionQueue {...props} page={{ ...props.page, readId: "read-2" }} />);
  expect(onCompleteActivity).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Complete using refreshed activity" }));
  await waitFor(() => expect(onCompleteActivity).toHaveBeenCalledTimes(2));
});

test("known permission loss retains its denied state until refresh and never echoes the server payload", async () => {
  const onCompleteActivity = vi.fn(() =>
    Promise.resolve({
      ok: false as const,
      error: { id: "E_PERM_001", detail: "hidden person" },
    }),
  );
  const props = { ...queueProps(), onCompleteActivity };
  const view = render(<NextActionQueue {...props} />);
  fireEvent.click(completeButton());
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("You can no longer change this activity"),
  );
  expect(document.body.textContent).not.toContain("hidden person");
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
  const rows = props.page.rows.map((row) =>
    row.kind === "activity" ? { ...row, canComplete: false } : row,
  );
  view.rerender(<NextActionQueue {...props} page={{ ...props.page, readId: "read-2", rows }} />);
  expect(
    screen.queryByRole("button", { name: "Complete using refreshed activity" }),
  ).not.toBeInTheDocument();
  expect(onCompleteActivity).toHaveBeenCalledTimes(1);
});

test("an acknowledgement for another activity is unconfirmed for this row", async () => {
  const onCompleteActivity = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: { id: "other-activity" },
    }),
  );
  render(<NextActionQueue {...queueProps()} onCompleteActivity={onCompleteActivity} />);
  fireEvent.click(completeButton());
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Completion could not be confirmed"),
  );
  expect(completeButton()).toBeDisabled();
});

test("an activity and opportunity may share an ID without sharing completion state", async () => {
  const props = queueProps();
  const page = { ...props.page, rows: props.page.rows.map((row) => ({ ...row, id: "shared-id" })) };
  const onCompleteActivity = vi.fn(() => Promise.reject(new Error("lost completion response")));
  render(<NextActionQueue {...props} page={page} onCompleteActivity={onCompleteActivity} />);
  fireEvent.click(completeButton());
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Completion could not be confirmed"),
  );
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Schedule activity: پیشنهاد / Angebot" }),
  ).toBeEnabled();
});

test.each(["saved", "unconfirmed"] as const)(
  "a read received during completion cannot release its later %s state",
  async (outcome) => {
    let finish!: (result: QueueCompletionResult) => void;
    let fail!: () => void;
    const completion = new Promise<QueueCompletionResult>((resolve, reject) => {
      finish = resolve;
      fail = () => reject(new Error("response lost after the intervening read"));
    });
    const onCompleteActivity = vi.fn(() => completion);
    const props = { ...queueProps(), onCompleteActivity };
    const view = render(<NextActionQueue {...props} />);
    fireEvent.click(completeButton());
    view.rerender(
      <NextActionQueue {...props} page={{ ...props.page, readId: "read-while-pending" }} />,
    );
    expect(completeButton()).toBeDisabled();
    await act(async () => {
      if (outcome === "saved") {
        finish({ ok: true, value: { id: "activity-1" } });
        await completion;
      } else {
        fail();
        await expect(completion).rejects.toThrow("response lost after the intervening read");
      }
    });
    if (outcome === "saved") {
      expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Completion saved");
    } else {
      expect(screen.getByRole("alert")).toHaveTextContent("Completion could not be confirmed");
      expect(
        screen.queryByRole("button", { name: "Complete using refreshed activity" }),
      ).not.toBeInTheDocument();
    }
    view.rerender(
      <NextActionQueue {...props} page={{ ...props.page, readId: "read-after-outcome" }} />,
    );
    if (outcome === "saved") expect(completeButton()).toBeEnabled();
    else
      expect(
        screen.getByRole("button", { name: "Complete using refreshed activity" }),
      ).toBeEnabled();
    expect(onCompleteActivity).toHaveBeenCalledTimes(1);
  },
);
