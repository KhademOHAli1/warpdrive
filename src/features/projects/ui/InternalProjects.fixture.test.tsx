// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type * as DndKit from "@dnd-kit/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { err } from "@/types/result";
import { createProjectsFixture, fixtureEditorId, fixtureProjectId } from "../testing/fixture";
import { InternalProjectsList } from "./InternalProjectsList";
import { InternalProjectWorkspace } from "./InternalProjectWorkspace";

const drag = vi.hoisted(() => ({ end: undefined as DndKit.DndContextProps["onDragEnd"] }));

vi.mock("@dnd-kit/core", async (load) => {
  const actual = await load<typeof DndKit>();
  return {
    ...actual,
    DndContext(props: ComponentProps<typeof actual.DndContext>) {
      drag.end = (event) => props.onDragEnd?.(event);
      return props.children;
    },
  };
});

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  drag.end = undefined;
});

function getWorkspace(fixture: ReturnType<typeof createProjectsFixture>) {
  const initial = fixture.workspace(fixtureProjectId);
  if (initial === undefined) throw new Error("Expected the seeded project");
  return initial;
}

function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

test("creates an internal project and returns its link in the project index", async () => {
  const fixture = createProjectsFixture();
  const user = userEvent.setup();
  render(
    <InternalProjectsList initial={fixture.index()} commands={fixture.commands} locale="en" />,
  );

  expect(screen.getByRole("link", { name: /Office move/ })).toHaveAttribute(
    "href",
    `/projects/internal/${fixtureProjectId}`,
  );
  await user.click(screen.getByRole("button", { name: "New project" }));
  await user.type(screen.getByRole("textbox", { name: "Project name" }), "Office equipment");
  await user.click(screen.getByRole("button", { name: "Save" }));

  const project = fixture.index().projects.find(({ title }) => title === "Office equipment");
  expect(project).toBeDefined();
  expect(await screen.findByRole("link", { name: /Office equipment/ })).toHaveAttribute(
    "href",
    `/projects/internal/${project?.id ?? ""}`,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("creates, assigns, and moves the same work item through list and board", async () => {
  const fixture = createProjectsFixture();
  const user = userEvent.setup();
  render(
    <InternalProjectWorkspace
      initial={getWorkspace(fixture)}
      commands={fixture.commands}
      locale="en"
    />,
  );

  await user.click(screen.getByRole("button", { name: "New work item" }));
  await user.type(screen.getByRole("textbox", { name: "Work item title" }), "Inspect the wiring");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const assigneeLabel = "Assignee for Inspect the wiring";
  const statusLabel = "Status for Inspect the wiring";
  await screen.findByRole("combobox", { name: statusLabel });
  choose(assigneeLabel, "Jules Kim");
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: assigneeLabel })).toHaveTextContent("Jules Kim"),
  );

  await user.click(screen.getByRole("tab", { name: "Board" }));
  expect(
    within(screen.getByRole("region", { name: "To do" })).getByText("Inspect the wiring"),
  ).toBeVisible();
  const item = getWorkspace(fixture).items.find(({ title }) => title === "Inspect the wiring");
  expect(item?.assigneeId).toBe(fixtureEditorId);
  expect(drag.end).toBeDefined();
  act(() => {
    drag.end?.({ active: { id: item?.id }, over: { id: "in-progress" } } as DndKit.DragEndEvent);
  });
  expect(
    await within(screen.getByRole("region", { name: "In progress" })).findByText(
      "Inspect the wiring",
    ),
  ).toBeVisible();

  await user.click(screen.getByRole("tab", { name: "List" }));
  expect(screen.getByRole("combobox", { name: statusLabel })).toHaveTextContent("In progress");
  expect(screen.getByRole("combobox", { name: assigneeLabel })).toHaveTextContent("Jules Kim");
});

test("keeps the previous work item and reports a rejected write in either view", async () => {
  const fixture = createProjectsFixture();
  const updateItem = vi
    .fn<typeof fixture.commands.updateItem>()
    .mockResolvedValue(err("project_forbidden"));
  const commands = { ...fixture.commands, updateItem };
  const user = userEvent.setup();
  render(
    <InternalProjectWorkspace initial={getWorkspace(fixture)} commands={commands} locale="en" />,
  );

  const statusLabel = "Status for Check network outlets";
  choose(statusLabel, "Done");
  expect(await screen.findByRole("alert")).toHaveTextContent("You don’t have permission");
  expect(screen.getByRole("combobox", { name: statusLabel })).toHaveTextContent("To do");
  expect(updateItem).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: fixtureProjectId,
      revision: 0,
      status: "done",
    }),
  );

  await user.click(screen.getByRole("tab", { name: "Board" }));
  expect(
    within(screen.getByRole("region", { name: "To do" })).getByText("Check network outlets"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Done" })).queryByText("Check network outlets"),
  ).not.toBeInTheDocument();
});

test("manages active staff membership and exposes changes to the assignee picker", async () => {
  const fixture = createProjectsFixture();
  const user = userEvent.setup();
  render(
    <InternalProjectWorkspace
      initial={getWorkspace(fixture)}
      commands={fixture.commands}
      locale="en"
    />,
  );

  await user.click(screen.getByRole("tab", { name: "Members" }));
  choose("Staff member", "Pat Stone");
  await user.click(screen.getByRole("button", { name: "Add member" }));
  expect(
    await screen.findByRole("checkbox", { name: "Allow Pat Stone to assign work" }),
  ).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Allow Pat Stone to assign work" }));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Allow Pat Stone to assign work" })).toBeChecked(),
  );
  choose("Access for Pat Stone", "Viewer");
  await waitFor(() =>
    expect(
      screen.queryByRole("checkbox", { name: "Allow Pat Stone to assign work" }),
    ).not.toBeInTheDocument(),
  );

  await user.click(screen.getByRole("tab", { name: "List" }));
  const assigneeLabel = "Assignee for Check network outlets";
  choose(assigneeLabel, "Pat Stone");
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: assigneeLabel })).toHaveTextContent("Pat Stone"),
  );

  await user.click(screen.getByRole("tab", { name: "Members" }));
  await user.click(screen.getByRole("button", { name: "Remove Pat Stone" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Remove Pat Stone" })).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("tab", { name: "List" }));
  expect(screen.getByRole("combobox", { name: assigneeLabel })).toHaveTextContent("Unassigned");
});

test("renders a viewer’s list and board without project mutation controls", async () => {
  const fixture = createProjectsFixture();
  const user = userEvent.setup();
  const initial = {
    ...getWorkspace(fixture),
    canAssign: false,
    canEdit: false,
    canManageMembers: false,
  };
  render(<InternalProjectWorkspace initial={initial} commands={fixture.commands} locale="en" />);
  expect(screen.getByText("Check network outlets")).toBeVisible();
  expect(screen.queryByRole("button", { name: "New work item" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Board" }));
  expect(
    within(screen.getByRole("region", { name: "To do" })).getByText("Check network outlets"),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Move Check network outlets" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Members" }));
  expect(screen.getByText("Alex Morgan")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
});

test("shows a historical assignee without offering an ineligible staff member for assignment", () => {
  const fixture = createProjectsFixture();
  const initial = getWorkspace(fixture);
  initial.assignees = initial.assignees.filter(({ id }) => id !== fixtureEditorId);
  render(<InternalProjectWorkspace initial={initial} commands={fixture.commands} locale="en" />);

  const assignment = screen.getByRole("combobox", { name: "Assignee for Confirm moving date" });
  expect(assignment).toHaveTextContent("Jules Kim");
  fireEvent.click(assignment);
  expect(screen.queryByRole("option", { name: "Jules Kim" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Unassigned" })).toBeVisible();
});
