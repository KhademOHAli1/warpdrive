// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { ProjectSummary } from "../contracts";
import { PlaneProjectDirectory } from "./planeDirectory";
import { projectsTranslator } from "./projectMessages";

const labels = projectsTranslator("en");
const alex = { id: "alex", name: "Alex Morgan" };
const lana = { id: "lana", name: "Lana Rivera" };
const project = (id: string, title: string, owner: ProjectSummary["owner"], daysAgo: number) => ({
  id,
  title,
  identifier: id.toUpperCase(),
  owner,
  archived: false,
  createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
});
const projects = [
  project("archive", "Archive inventory", lana, 34),
  project("receiving", "Receiving workflow", alex, 12),
  project("dock", "Dock labels", alex, 2),
];

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function choose(label: string, value: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: value }));
}

function cardTitles() {
  return screen.queryAllByRole("heading", { level: 3 }).map((element) => element.textContent);
}

test("sorts readable projects by recorded creation time and title", () => {
  render(<PlaneProjectDirectory projects={projects} labels={labels} locale="en" />);

  expect(cardTitles()).toEqual(["Dock labels", "Receiving workflow", "Archive inventory"]);
  choose("Sort projects", "Oldest first");
  expect(cardTitles()).toEqual(["Archive inventory", "Receiving workflow", "Dock labels"]);
  choose("Sort projects", "Title Z–A");
  expect(cardTitles()).toEqual(["Receiving workflow", "Dock labels", "Archive inventory"]);
  choose("Sort projects", "Title A–Z");
  expect(cardTitles()).toEqual(["Archive inventory", "Dock labels", "Receiving workflow"]);
});

test("combines live search, authoritative owner and creation date filters", async () => {
  const user = userEvent.setup();
  render(<PlaneProjectDirectory projects={projects} labels={labels} locale="en" />);

  await user.type(screen.getByRole("searchbox", { name: "Search projects" }), "MORGAN");
  expect(cardTitles()).toEqual(["Dock labels", "Receiving workflow"]);
  expect(screen.getByRole("status")).toHaveTextContent("2 of 3 projects");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  choose("Filter by owner", "Alex Morgan");
  choose("Filter by creation date", "Last 7 days");
  expect(cardTitles()).toEqual(["Dock labels"]);
  choose("Filter by owner", "Lana Rivera");
  expect(screen.getByText("No matching projects")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(cardTitles()).toHaveLength(3);
});

test("opens the native project route from both navigation actions and copies its URL", async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<PlaneProjectDirectory projects={projects} labels={labels} locale="en" />);

  expect(screen.getByRole("link", { name: /Dock labels/ })).toHaveAttribute(
    "href",
    "/projects/internal/dock",
  );
  const trigger = screen.getByRole("button", { name: "Actions for Dock labels" });
  await user.click(trigger);
  expect(screen.getByRole("menuitem", { name: "Open in new tab" })).toHaveAttribute(
    "target",
    "_blank",
  );
  await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
  expect(write).toHaveBeenCalledWith(`${window.location.origin}/projects/internal/dock`);
  expect(await screen.findByText("Project link copied.")).toBeVisible();
});

test("distinguishes an empty directory from filters with no matches", () => {
  render(<PlaneProjectDirectory projects={[]} labels={labels} locale="en" />);
  expect(screen.getByText("No internal projects")).toBeVisible();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
