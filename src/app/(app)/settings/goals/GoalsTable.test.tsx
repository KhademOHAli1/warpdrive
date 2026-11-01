// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@/db/schema/goals";
import { GoalsTable } from "./GoalsTable";

const actions = vi.hoisted(() => ({ deleteGoalAction: vi.fn() }));
vi.mock("@/features/goals/actions", () => actions);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

afterEach(cleanup);

function goal(overrides: Partial<Goal>): Goal {
  return {
    id: "g1",
    subject: "activity",
    action: "completed",
    metric: "count",
    assigneeKind: "company",
    assigneeId: null,
    pipelineId: null,
    activityTypeId: null,
    interval: "monthly",
    target: "200.00",
    currency: "USD",
    startsOn: "2026-08-24",
    endsOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("GoalsTable", () => {
  it("keeps a goal visible and reports a rejected delete for retry", async () => {
    actions.deleteGoalAction.mockRejectedValueOnce(new Error("offline"));
    render(
      <GoalsTable goals={[goal({})]} assigneeNames={{}} onChanged={vi.fn()} onEdit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the goal.");
    expect(screen.getByText("200")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Delete: / })).toBeEnabled());
  });

  it("states a count target as a whole number", () => {
    render(
      <GoalsTable goals={[goal({})]} assigneeNames={{}} onChanged={() => {}} onEdit={() => {}} />,
    );
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("drops the empty cents from a whole-money target", () => {
    render(
      <GoalsTable
        goals={[goal({ subject: "deal", action: "won", metric: "value", target: "20000.00" })]}
        assigneeNames={{}}
        onChanged={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByText("20,000 USD")).toBeInTheDocument();
  });
});

it("uses a complete Persian goal phrase and localized unknown assignee labels", async () => {
  const { LocaleProvider } = await import("@/features/i18n/LocaleProvider");
  render(
    <LocaleProvider locale="fa">
      <GoalsTable
        goals={[
          goal({ assigneeKind: "user", assigneeId: "missing-user" }),
          goal({ id: "g2", assigneeKind: "team", assigneeId: "missing-team" }),
        ]}
        assigneeNames={{}}
        onChanged={() => {}}
        onEdit={() => {}}
      />
    </LocaleProvider>,
  );
  expect(screen.getAllByText("فعالیت‌های انجام‌شده، ماهانه")).toHaveLength(2);
  expect(screen.getByText("کاربر نامشخص")).toBeInTheDocument();
  expect(screen.getByText("تیم نامشخص")).toBeInTheDocument();
});
