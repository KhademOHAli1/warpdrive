// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { OutputTarget } from "../connectionGestures";
import { newIfElseBranch, newIfElseConfig } from "../ifElse";
import type { WorkflowNode } from "../schemas";
import { type CanvasNode, WorkflowNodeCard } from "./WorkflowNodeCard";

vi.mock("@xyflow/react", () => ({
  Handle: ({
    id,
    type,
    position,
    style,
    "aria-label": label,
  }: {
    id: string;
    type: string;
    position: string;
    style?: CSSProperties;
    "aria-label"?: string;
  }) => (
    <span
      role="img"
      data-testid={`handle-${id}`}
      data-position={position}
      data-type={type}
      aria-label={label}
      style={style}
    />
  ),
  Position: { Top: "top", Bottom: "bottom", Right: "right" },
}));

afterEach(cleanup);

const wait: WorkflowNode = {
  id: "wait",
  name: "Wait",
  nameMode: "automatic",
  type: "delay",
  version: 1,
  config: { minutes: { kind: "value", value: 5 } },
};

function props(
  node: WorkflowNode,
  selected: boolean,
  actions: {
    onConfigure?: () => void;
    onChangeType?: () => void;
    onDuplicate?: () => void;
    onRemove?: () => void;
    onAdd?: (source: OutputTarget) => void;
  } = {},
): NodeProps<CanvasNode> {
  return {
    id: node.id,
    type: "workflow",
    data: { node, invalid: false, index: 0, ...actions },
    selected,
    isConnectable: false,
    zIndex: 0,
    dragging: false,
    draggable: false,
    selectable: true,
    deletable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

it("offers selected-node options that change the node type and delete the actual step", async () => {
  const user = userEvent.setup();
  const changeType = vi.fn();
  const remove = vi.fn();
  render(
    <WorkflowNodeCard {...props(wait, true, { onChangeType: changeType, onRemove: remove })} />,
  );
  const options = screen.getByRole("button", { name: "Node options" });
  expect(options.textContent).toBe("");
  await user.click(options);
  await user.click(screen.getByRole("menuitem", { name: "Change node", exact: true }));
  expect(changeType).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(options);
  await user.click(screen.getByRole("menuitem", { name: "Delete node", exact: true }));
  expect(remove).toHaveBeenCalledOnce();
  expect(changeType).toHaveBeenCalledOnce();
});

it("withholds mutation options when a step is unselected or read-only", () => {
  const actions = { onChangeType: vi.fn(), onRemove: vi.fn() };
  const view = render(<WorkflowNodeCard {...props(wait, false, actions)} />);
  expect(screen.queryByRole("button", { name: "Node options" })).not.toBeInTheDocument();
  view.rerender(<WorkflowNodeCard {...props(wait, true)} />);
  expect(screen.queryByRole("button", { name: "Node options" })).not.toBeInTheDocument();
  expect(actions.onChangeType).not.toHaveBeenCalled();
  expect(actions.onRemove).not.toHaveBeenCalled();
});

it("keeps trigger type selection available without offering trigger removal", async () => {
  const user = userEvent.setup();
  const trigger: WorkflowNode = {
    ...wait,
    id: "start",
    type: "trigger.manual",
    name: "Manual start",
    config: {},
  };
  const changeType = vi.fn();
  const remove = vi.fn();
  render(
    <WorkflowNodeCard {...props(trigger, true, { onChangeType: changeType, onRemove: remove })} />,
  );
  await user.click(screen.getByRole("button", { name: "Node options" }));
  expect(
    screen.queryByRole("menuitem", { name: "Delete node", exact: true }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Change node", exact: true }));
  expect(changeType).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
});

it("keeps Farsi node options named and keyboard accessible", async () => {
  const user = userEvent.setup();
  const changeType = vi.fn();
  render(
    <LocaleProvider locale="fa">
      <WorkflowNodeCard {...props(wait, true, { onChangeType: changeType })} />
    </LocaleProvider>,
  );
  const options = screen.getByRole("button", { name: "گزینه‌های مرحله" });
  options.focus();
  await user.keyboard("{Enter}");
  const menu = screen.getByRole("menu");
  expect(
    within(menu).getByRole("menuitem", { name: "تغییر مرحله", exact: true }),
  ).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(options).toHaveFocus();
  expect(changeType).not.toHaveBeenCalled();
});

it("does not present configuration as a node-type replacement action", () => {
  const configure = vi.fn();
  render(<WorkflowNodeCard {...props(wait, true, { onConfigure: configure })} />);
  expect(screen.queryByRole("button", { name: "Node options" })).not.toBeInTheDocument();
  expect(configure).not.toHaveBeenCalled();
});

it("duplicates the selected action through its actual callback without changing or removing it", async () => {
  const user = userEvent.setup();
  const duplicate = vi.fn();
  const changeType = vi.fn();
  const remove = vi.fn();
  render(
    <WorkflowNodeCard
      {...props(wait, true, { onDuplicate: duplicate, onChangeType: changeType, onRemove: remove })}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Node options" }));
  await user.click(screen.getByRole("menuitem", { name: "Duplicate node", exact: true }));
  expect(duplicate).toHaveBeenCalledOnce();
  expect(changeType).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("never offers duplication for the required trigger even if a callback is accidentally supplied", async () => {
  const user = userEvent.setup();
  const duplicate = vi.fn();
  const trigger: WorkflowNode = { ...wait, id: "start", type: "trigger.manual", config: {} };
  render(
    <WorkflowNodeCard
      {...props(trigger, true, { onDuplicate: duplicate, onChangeType: vi.fn() })}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Node options" }));
  expect(
    screen.queryByRole("menuitem", { name: "Duplicate node", exact: true }),
  ).not.toBeInTheDocument();
  expect(duplicate).not.toHaveBeenCalled();
});

it("keeps conditional port IDs while routing Matches right and Otherwise down", async () => {
  const user = userEvent.setup();
  const condition: WorkflowNode = {
    ...wait,
    id: "check",
    type: "condition",
    name: "Condition",
    config: {},
  };
  const add = vi.fn();
  render(<WorkflowNodeCard {...props(condition, false, { onAdd: add })} />);
  expect(screen.getByTestId("handle-in")).toHaveAttribute("data-position", "top");
  expect(screen.getByTestId("handle-true")).toHaveAttribute("data-position", "right");
  expect(screen.getByTestId("handle-false")).toHaveAttribute("data-position", "bottom");
  await user.click(screen.getByRole("button", { name: "Add a step after Condition: Matches" }));
  await user.click(
    screen.getByRole("button", { name: "Add a step after Condition: Otherwise (default)" }),
  );
  expect(add.mock.calls).toEqual([
    [{ from: "check", port: "true" }],
    [{ from: "check", port: "false" }],
  ]);
});

it("keeps ordered routes separately addressable along the bottom and adds the chosen route", async () => {
  const config = newIfElseConfig();
  config.branches.push(newIfElseBranch("follow_up"));
  const branch: WorkflowNode = {
    ...wait,
    type: "ifElse",
    id: "switch",
    name: "If/Else",
    nameMode: "custom",
    config,
  };
  const onAdd = vi.fn();
  render(<WorkflowNodeCard {...props(branch, false, { onAdd })} />);
  const handles = ["if", "follow_up", "else"].map((id) =>
    screen.getByTestId(`handle-branch:${id}`),
  );
  expect(handles.map((handle) => handle.getAttribute("aria-label"))).toEqual([
    "If",
    "Else if 1",
    "Else",
  ]);
  expect(handles.every((handle) => handle.dataset.position === "bottom")).toBe(true);
  expect(new Set(handles.map((handle) => handle.style.left)).size).toBe(3);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add a step after If/Else: Else if 1" }));
  expect(onAdd).toHaveBeenCalledExactlyOnceWith({ from: "switch", port: "branch:follow_up" });
});
