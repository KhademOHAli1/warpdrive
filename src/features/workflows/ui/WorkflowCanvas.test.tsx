// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { NodeChange, ReactFlowProps } from "@xyflow/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { CanvasNode } from "./WorkflowNodeCard";

const flow = vi.hoisted(() => {
  const props: ReactFlowProps<CanvasNode> = {};
  return {
    nodes: [] as CanvasNode[],
    change: undefined as undefined | ((changes: NodeChange<CanvasNode>[]) => void),
    props,
  };
});
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: ReactFlowProps<CanvasNode>) => {
    flow.props = props;
    flow.nodes = props.nodes ?? [];
    flow.change = props.onNodesChange;
    return null;
  },
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom" },
  ConnectionLineType: { SmoothStep: "smoothstep" },
  useConnection: () => ({ inProgress: false }),
}));
afterEach(cleanup);
it("retains node measurements during selection and language changes without dirtying the graph", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const onChange = vi.fn();
  const draw = (locale: "en" | "fa") => (
    <LocaleProvider locale={locale}>
      <WorkflowCanvas
        definition={definition}
        selected="start"
        selectedEdge={null}
        onSelect={vi.fn()}
        onSelectEdge={vi.fn()}
        onChange={onChange}
        onProblem={vi.fn()}
        editable
        invalidNodes={new Set()}
        layoutRevision={0}
      />
    </LocaleProvider>
  );
  const view = render(draw("en"));
  act(() =>
    flow.change?.([{ id: "start", type: "dimensions", dimensions: { width: 288, height: 82 } }]),
  );
  expect(flow.nodes[0]?.measured).toEqual({ width: 288, height: 82 });
  view.rerender(draw("fa"));
  expect(flow.nodes[0]?.measured).toEqual({ width: 288, height: 82 });
  expect(onChange).not.toHaveBeenCalled();
});
it("previews the same connection rules used on drop and commits one edit per drag", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  definition.nodes.push({ ...definition.nodes[2]!, id: "extra" });
  const onChange = vi.fn();
  const onProblem = vi.fn();
  render(
    <LocaleProvider locale="en">
      <WorkflowCanvas
        definition={definition}
        selected="start"
        selectedEdge={null}
        onSelect={vi.fn()}
        onSelectEdge={vi.fn()}
        onChange={onChange}
        onProblem={onProblem}
        editable
        invalidNodes={new Set()}
        layoutRevision={0}
      />
    </LocaleProvider>,
  );
  const connection = { source: "read", target: "extra", sourceHandle: "next", targetHandle: "in" };
  expect(flow.props.isValidConnection?.(connection)).toBe(true);
  expect(flow.props.isValidConnection?.({ ...connection, target: "read", source: "task" })).toBe(
    false,
  );
  act(() => flow.props.onConnect?.(connection));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onProblem).toHaveBeenLastCalledWith(null);
  onChange.mockClear();
  act(() =>
    flow.change?.([{ id: "task", type: "position", position: { x: 20, y: 400 }, dragging: true }]),
  );
  act(() =>
    flow.change?.([{ id: "task", type: "position", position: { x: 40, y: 440 }, dragging: true }]),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(flow.nodes.find((node) => node.id === "task")?.position).toEqual({ x: 40, y: 440 });
  act(() =>
    flow.change?.([{ id: "task", type: "position", position: { x: 40, y: 440 }, dragging: false }]),
  );
  expect(onChange).toHaveBeenCalledTimes(1);
});
