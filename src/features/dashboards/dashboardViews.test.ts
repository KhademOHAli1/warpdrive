import { expect, it } from "vitest";
import { dashboardViewHref, isCurrentDashboard } from "./dashboardViews";

it.each([
  ["board", "/pipeline/p1"],
  ["list", "/pipeline/p1/list"],
  ["archived", "/pipeline/p1/archived"],
] as const)("retains the %s pipeline view when changing dashboards", (view, href) => {
  expect(dashboardViewHref({ kind: "pipeline", pipelineId: "p1" }, view)).toBe(href);
});

it("keeps Performance on its existing route independently of the pipeline view", () => {
  expect(dashboardViewHref({ kind: "performance" }, "archived")).toBe("/dashboard");
});

it("matches current destinations without inventing a selection for the empty state", () => {
  expect(isCurrentDashboard(null, { kind: "performance" })).toBe(false);
  expect(isCurrentDashboard({ kind: "performance" }, { kind: "performance" })).toBe(true);
  expect(isCurrentDashboard({ kind: "performance" }, { kind: "pipeline", pipelineId: "p1" })).toBe(
    false,
  );
  expect(
    isCurrentDashboard(
      { kind: "pipeline", pipelineId: "p1" },
      { kind: "pipeline", pipelineId: "p2" },
    ),
  ).toBe(false);
});
