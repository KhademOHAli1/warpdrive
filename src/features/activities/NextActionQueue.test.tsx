// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { NextActionQueue } from "./NextActionQueue";
import { queueProps } from "./NextActionQueue.test-support";

afterEach(cleanup);

test("renders authorized authored work with its explicit queue reason", () => {
  render(<NextActionQueue {...queueProps()} />);
  expect(screen.getByText("پیگیری / Follow-up")).toBeVisible();
  expect(screen.getByText("Overdue activity")).toBeVisible();
  expect(screen.getByText("1 overdue activity")).toBeVisible();
  expect(screen.getByRole("button", { name: "Edit activity: پیگیری / Follow-up" })).toBeEnabled();
});

test("loading never exposes old rows, counts or an ordinary empty result", () => {
  render(<NextActionQueue {...queueProps()} loading />);
  expect(screen.getByRole("status")).toHaveTextContent("Updating next actions");
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
  expect(screen.queryByText("No next actions in this view.")).not.toBeInTheDocument();
});

test("a failed read suppresses old results and offers persistent explicit retry", () => {
  const props = queueProps();
  render(<NextActionQueue {...props} error />);
  expect(screen.getByRole("alert")).toHaveTextContent("Next actions could not be loaded");
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
  expect(screen.queryByText("No next actions in this view.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
});

test.each([
  { scope: "all-permitted" as const, limit: 25, offset: 0 },
  { scope: "mine" as const, limit: 25, offset: 25 },
  { scope: "mine" as const, limit: 50, offset: 0 },
])("late data for a different query never exposes its rows or counts", (input) => {
  render(<NextActionQueue {...queueProps()} input={input} />);
  expect(screen.getByRole("status")).toHaveTextContent("Updating next actions");
  expect(screen.queryByText("پیگیری / Follow-up")).not.toBeInTheDocument();
  expect(screen.queryByText("1 overdue activity")).not.toBeInTheDocument();
});

test("true empty results and an emptied later page have different recovery", () => {
  const props = queueProps();
  const page = { ...props.page, rows: [], total: 0, counts: { overdue: 0, missingNextStep: 0 } };
  const view = render(<NextActionQueue {...props} page={page} />);
  expect(screen.getByText("No next actions in this view.")).toBeVisible();
  view.rerender(
    <NextActionQueue
      {...props}
      input={{ ...props.input, offset: 50 }}
      page={{ ...page, total: 50, offset: 50 }}
    />,
  );
  expect(screen.queryByText("No next actions in this view.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "First page" }));
  expect(props.onPageChange).toHaveBeenCalledWith(0);
});

test("uses server totals for bounded navigation and narrows work without granting access", () => {
  const props = queueProps();
  render(<NextActionQueue {...props} page={{ ...props.page, total: 50 }} />);
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(props.onPageChange).toHaveBeenCalledWith(25);
  expect(screen.getByRole("combobox", { name: "Work shown" })).toBeVisible();
});

test("hints suppress write controls and null secondary references create no labels", () => {
  const props = queueProps();
  const rows = props.page.rows.map((row) =>
    row.kind === "activity"
      ? { ...row, canEdit: false, canComplete: false }
      : { ...row, canSchedule: false },
  );
  render(<NextActionQueue {...props} page={{ ...props.page, rows }} />);
  expect(screen.getByText("This activity is read-only for you.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Edit activity:/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Schedule activity:/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "فرصت / Chance" })).toHaveAttribute(
    "href",
    "/deals/linked-deal",
  );
  expect(document.body.textContent).not.toContain("undefined");
  expect(document.body.textContent).not.toContain("null");
});

test("schedule and edit callbacks use the existing canonical rows without fabricating activities", () => {
  const props = queueProps();
  render(<NextActionQueue {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit activity: پیگیری / Follow-up" }));
  fireEvent.click(screen.getByRole("button", { name: "Schedule activity: پیشنهاد / Angebot" }));
  expect(props.onEditActivity).toHaveBeenCalledWith(props.page.rows[0]);
  expect(props.onScheduleDeal).toHaveBeenCalledWith(props.page.rows[1]);
  expect(screen.getByText("Needs a next activity")).toBeVisible();
  expect(screen.getByText("No past activity recorded")).toBeVisible();
});
