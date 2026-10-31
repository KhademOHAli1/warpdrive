// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Goal } from "@/db/schema/goals";

const actions = vi.hoisted(() => ({
  createGoalAction: vi.fn<() => Promise<{ ok: true } | { ok: false; error: { id: string } }>>(() =>
    Promise.resolve({ ok: true }),
  ),
  updateGoalAction: vi.fn(),
  deleteGoalAction: vi.fn(),
}));
vi.mock("@/features/goals/actions", () => actions);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { GoalsClient } from "./GoalsClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function show() {
  return render(<GoalsClient goals={[]} users={[]} teams={[]} pipelines={[]} activityTypes={[]} />);
}

it("returns focus to the edited goal action after cancellation", async () => {
  const goal: Goal = {
    id: "g1",
    subject: "activity",
    action: "completed",
    metric: "count",
    assigneeKind: "company",
    assigneeId: null,
    pipelineId: null,
    activityTypeId: null,
    interval: "monthly",
    target: "200",
    currency: "EUR",
    startsOn: "2026-10-31",
    endsOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  render(<GoalsClient goals={[goal]} users={[]} teams={[]} pipelines={[]} activityTypes={[]} />);
  const edit = screen.getByRole("button", { name: /^Edit: / });
  edit.focus();
  fireEvent.click(edit);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(edit).toHaveFocus());
});

it("starts with the goal list and opens creation as a focused task", () => {
  show();
  expect(screen.queryByLabelText("Target")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New goal" }));
  const task = screen.getByRole("dialog", { name: "New goal" });
  expect(within(task).getByLabelText("Target")).toBeInTheDocument();
  fireEvent.click(within(task).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(actions.createGoalAction).not.toHaveBeenCalled();
});

it("retains a failed goal draft inside the focused task", async () => {
  actions.createGoalAction.mockResolvedValueOnce({ ok: false, error: { id: "E_GOAL_001" } });
  show();
  fireEvent.click(screen.getByRole("button", { name: "New goal" }));
  const task = screen.getByRole("dialog", { name: "New goal" });
  fireEvent.change(within(task).getByLabelText("Target"), { target: { value: "250" } });
  fireEvent.click(within(task).getByRole("button", { name: "Create goal" }));
  expect(await within(task).findByRole("alert")).toBeInTheDocument();
  expect(within(task).getByLabelText("Target")).toHaveValue("250");
});

it("prevents dismissal while creation is pending and closes after success", async () => {
  let finish: ((result: { ok: true }) => void) | undefined;
  actions.createGoalAction.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "New goal" }));
  const task = screen.getByRole("dialog", { name: "New goal" });
  fireEvent.change(within(task).getByLabelText("Target"), { target: { value: "250" } });
  fireEvent.click(within(task).getByRole("button", { name: "Create goal" }));
  expect(within(task).getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.keyDown(task, { key: "Escape" });
  expect(task).toBeInTheDocument();
  finish?.({ ok: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
