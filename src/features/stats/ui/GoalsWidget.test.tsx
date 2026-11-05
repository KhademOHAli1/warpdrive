// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { STRINGS } from "@/constants/strings";
import type { Goal } from "@/db/schema/goals";
import type { GoalWithProgress } from "@/features/goals/router";
import { GoalsWidget } from "./GoalsWidget";

function seriesTo(day: string, actual: string): { day: string; actual: string }[] {
  return [{ day, actual }];
}

function countGoal(target: string, actual: string): GoalWithProgress {
  const goal: Goal = {
    id: "g1",
    currency: "USD",
    subject: "activity",
    action: "completed",
    metric: "count",
    assigneeKind: "company",
    assigneeId: null,
    pipelineId: null,
    activityTypeId: null,
    interval: "monthly",
    target,
    startsOn: "2026-08-24",
    endsOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  return {
    goal,
    series: seriesTo("2026-08-24", actual),
    progress: {
      goalId: goal.id,
      periodStart: "2026-08-24",
      periodEnd: "2026-09-23",
      actual,
      target,
      attainment: Number(actual) / Number(target),
      pace: 3.44,
    },
  };
}

afterEach(cleanup);

describe("GoalsWidget", () => {
  it("explains unknown values without claiming a zero-loss value target is met", () => {
    const row = countGoal("0", "0");
    row.goal.subject = "deal";
    row.goal.action = "lost";
    row.goal.metric = "value";
    if (row.progress === null) throw new Error("Progress fixture missing");
    row.progress = {
      ...row.progress,
      dataState: "incomplete",
      missingMeasurementDateCount: 0,
      missingValueCount: 1,
      attainment: null,
      pace: null,
    };
    render(<GoalsWidget data={[row]} currency="USD" canManage={false} />);
    expect(screen.getByText("Incomplete", { exact: true })).toBeVisible();
    expect(screen.queryByText("Within limit", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/Some records are missing the value/)).toBeVisible();
    expect(screen.queryByText(/Some event dates are missing/)).not.toBeInTheDocument();
  });
  it("does not label an incomplete zero-loss result as within its limit", () => {
    const row = countGoal("0", "0");
    row.goal.subject = "deal";
    row.goal.action = "lost";
    if (row.progress === null) throw new Error("Progress fixture missing");
    row.progress = {
      ...row.progress,
      dataState: "incomplete",
      missingMeasurementDateCount: 1,
      attainment: null,
      pace: null,
    };
    render(<GoalsWidget data={[row]} currency="USD" canManage={false} />);
    expect(screen.getByText("Incomplete", { exact: true })).toBeVisible();
    expect(screen.queryByText("Within limit", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/Some event dates are missing/)).toBeVisible();
  });
  // The link is most useful exactly when there are no goals, so an empty state that swallows
  // it leaves an admin with nowhere to go.
  it("still offers the setup link when there are no goals", () => {
    render(<GoalsWidget data={[]} currency="USD" canManage />);
    expect(screen.getByText(STRINGS.dashboard.emptyGoals)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: STRINGS.dashboard.goalsSettingsLink }).getAttribute("href"),
    ).toBe("/settings/goals");
  });

  // "Set up goals" was bare text on a bare sentence: nothing said what a goal is, and nothing
  // marked the words as something you could click.
  it("explains what a goal is and gives the link a button affordance", () => {
    render(<GoalsWidget data={[]} currency="USD" canManage />);
    expect(screen.getByRole("status")).toHaveTextContent(STRINGS.dashboard.emptyGoalsBody);
    const link = screen.getByRole("link", { name: STRINGS.dashboard.goalsSettingsLink });
    expect(link.className).toContain("bg-action");
  });

  it("hides the setup link from someone who cannot manage goals", () => {
    render(<GoalsWidget data={[]} currency="USD" canManage={false} />);
    expect(screen.queryByRole("link", { name: STRINGS.dashboard.goalsSettingsLink })).toBeNull();
  });

  it("states a count target as a whole number", () => {
    render(<GoalsWidget data={[countGoal("200.00", "111")]} currency="USD" canManage={false} />);
    expect(screen.getByText("111 / 200")).toBeInTheDocument();
  });

  it("draws the period as a chart rather than a single bar", () => {
    const { container } = render(
      <GoalsWidget data={[countGoal("200.00", "111")]} currency="USD" canManage={false} />,
    );
    expect(container.querySelector('[data-slot="chart"]')).toBeInTheDocument();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("hides the drawn chart from assistive tech and leaves the figures in the row", () => {
    const { container } = render(
      <GoalsWidget data={[countGoal("200.00", "111")]} currency="USD" canManage={false} />,
    );
    expect(container.querySelector('[data-slot="chart"]')).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("111 / 200")).toBeInTheDocument();
  });
});
