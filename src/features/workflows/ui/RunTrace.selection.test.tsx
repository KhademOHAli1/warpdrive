// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { appendConnectedNode } from "@/features/workflows/connectionGestures";
import { initialDefinition } from "@/features/workflows/editorModel";
import { makeNode } from "@/features/workflows/nodeFactory";
import { type RunDetail, RunTrace } from "@/features/workflows/ui/RunTrace";

vi.mock("@/features/workflows/ui/WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas omitted from selected-step semantics regression</div>,
}));
afterEach(cleanup);

it("exposes the selected historical step and updates its accessible state by keyboard", async () => {
  const definition = initialDefinition({
    start: "Starting point",
    read: "Review record",
    task: "Contact customer",
    subject: "Call",
  });
  for (const node of definition.nodes) node.nameMode = "custom";
  const detail: RunDetail = {
    id: "8755a40e-fda9-4456-a3f4-7f6ff73a0eea",
    number: 1,
    status: "succeeded",
    mode: "simulation",
    resumeAt: null,
    errorId: null,
    nextNodeId: null,
    createdAt: new Date("2026-10-31T12:00:00Z"),
    updatedAt: new Date("2026-10-31T12:00:00Z"),
    definition,
    steps: [],
  };
  render(
    <LocaleProvider locale="en">
      <RunTrace detail={detail} />
    </LocaleProvider>,
  );
  const first = screen.getByRole("button", { name: /Starting point/ });
  const second = screen.getByRole("button", { name: /Review record/ });
  const user = userEvent.setup();
  second.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Review record" })).toBeInTheDocument();
  expect(second).toHaveAttribute("aria-pressed", "true");
  expect(first).toHaveAttribute("aria-pressed", "false");
});

it("lists inserted historical linear steps in connected path order with matching numbers", () => {
  const initial = initialDefinition({
    start: "Manual start",
    read: "Read deal",
    task: "Create task",
    subject: "Call",
  });
  const inserted = appendConnectedNode(
    initial,
    makeNode(initial, "delay", "wait", "Wait", "Call", "start"),
    { x: 0, y: 130 },
    { from: "start", port: "next" },
  );
  if (!inserted.ok) throw new Error(`Wait insertion failed: ${inserted.error}`);
  const definition = inserted.value;
  expect(definition.nodes.map((node) => node.id)).toEqual(["start", "read", "task", "wait"]);
  expect(definition.edges).toHaveLength(3);
  expect(definition.edges).toEqual(
    expect.arrayContaining([
      { from: "start", to: "wait", port: "next" },
      { from: "wait", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ]),
  );
  const detail: RunDetail = {
    id: "8755a40e-fda9-4456-a3f4-7f6ff73a0eea",
    number: 1,
    status: "succeeded",
    mode: "simulation",
    resumeAt: null,
    errorId: null,
    nextNodeId: null,
    createdAt: new Date("2026-10-31T12:00:00Z"),
    updatedAt: new Date("2026-10-31T12:00:00Z"),
    definition,
    steps: [],
  };
  render(
    <LocaleProvider locale="en">
      <RunTrace detail={detail} />
    </LocaleProvider>,
  );

  const buttons = within(screen.getByRole("list", { name: "Workflow steps" })).getAllByRole(
    "button",
  );
  expect(buttons).toHaveLength(4);
  expect(buttons[0]).toHaveAccessibleName(/^1 · Manual start/);
  expect(buttons[1]).toHaveAccessibleName(/^2 · Delay/);
  expect(buttons[2]).toHaveAccessibleName(/^3 · Read deal/);
  expect(buttons[3]).toHaveAccessibleName(/^4 · Create task/);
  expect(definition.nodes.map((node) => node.id)).toEqual(["start", "read", "task", "wait"]);
});
