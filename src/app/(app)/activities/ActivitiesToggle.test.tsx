// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ActivitiesToggle } from "./ActivitiesToggle";

afterEach(cleanup);

test("ordinary activity navigation has no queue exposure by default", () => {
  render(<ActivitiesToggle active="list" />);
  expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
    "href",
    "/activities/calendar",
  );
  expect(screen.queryByRole("link", { name: "Next actions" })).not.toBeInTheDocument();
});

test("enabled activity navigation offers a queue from the native list", () => {
  render(<ActivitiesToggle active="list" queueEnabled />);
  expect(screen.getByRole("link", { name: "Next actions" })).toHaveAttribute(
    "href",
    "/activities/queue",
  );
});

test("the active queue keeps both existing activity views available", () => {
  render(<ActivitiesToggle active="queue" queueEnabled />);
  expect(screen.getByText("Next actions")).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "List" })).toHaveAttribute("href", "/activities/list");
  expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
    "href",
    "/activities/calendar",
  );
});
