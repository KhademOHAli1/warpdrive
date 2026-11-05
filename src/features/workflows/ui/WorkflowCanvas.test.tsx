// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type {
  FinalConnectionState,
  NodeChange,
  ReactFlowInstance,
  ReactFlowProps,
} from "@xyflow/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { appendConnectedNode } from "../connectionGestures";
import { initialDefinition } from "../editorModel";
import { makeNode } from "../nodeFactory";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { WorkflowCanvasEdge } from "./WorkflowDiagramEdge";
import type { CanvasNode } from "./WorkflowNodeCard";

const flow = vi.hoisted(() => {
  const props: ReactFlowProps<CanvasNode, WorkflowCanvasEdge> = {};
  return {
    nodes: [] as CanvasNode[],
    change: undefined as undefined | ((changes: NodeChange<CanvasNode>[]) => void),
    props,
  };
});
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: ReactFlowProps<CanvasNode, WorkflowCanvasEdge>) => {
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
  const update = onChange.mock.calls[0]?.[0] as (graph: typeof definition) => typeof definition;
  expect(update(definition).layout?.task).toEqual({ x: 40, y: 440, anchor: "center" });
});

it("numbers inserted linear steps by connected path without reordering canvas nodes", () => {
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
  const creationOrder = ["start", "read", "task", "wait"];
  expect(definition.nodes.map((node) => node.id)).toEqual(creationOrder);
  expect(definition.edges).toHaveLength(3);
  expect(definition.edges).toEqual(
    expect.arrayContaining([
      { from: "start", to: "wait", port: "next" },
      { from: "wait", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ]),
  );
  render(
    <LocaleProvider locale="en">
      <WorkflowCanvas
        definition={definition}
        selected="wait"
        selectedEdge={null}
        onSelect={vi.fn()}
        onSelectEdge={vi.fn()}
        onChange={vi.fn()}
        onProblem={vi.fn()}
        editable
        invalidNodes={new Set()}
        layoutRevision={0}
      />
    </LocaleProvider>,
  );

  // ReactFlow's creation/z-order stays intact; only the displayed numeric indices follow the path.
  expect(flow.nodes.map((node) => node.id)).toEqual(creationOrder);
  expect(Object.fromEntries(flow.nodes.map((node) => [node.id, node.data.index]))).toEqual({
    start: 0,
    wait: 1,
    read: 2,
    task: 3,
  });
  expect(definition.nodes.map((node) => node.id)).toEqual(creationOrder);
});

it("routes edge insertion and disconnection controls through the existing graph callbacks", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const onAdd = vi.fn();
  const onChange = vi.fn();
  render(
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
      onAdd={onAdd}
    />,
  );
  const edge = flow.props.edges?.[0];
  const insert = edge?.data?.onInsert;
  const disconnect = edge?.data?.onDisconnect;
  expect(insert).toEqual(expect.any(Function));
  expect(disconnect).toEqual(expect.any(Function));
  const position = { x: 80, y: 140 };
  act(() => {
    if (typeof insert === "function") insert(position);
  });
  expect(onAdd).toHaveBeenCalledWith(
    { from: edge?.source, port: edge?.sourceHandle },
    { ...position, anchor: "center" },
  );
  expect(onChange).not.toHaveBeenCalled();
  act(() => {
    if (typeof disconnect === "function") disconnect();
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  const update = onChange.mock.calls[0]?.[0] as (current: typeof definition) => typeof definition;
  expect(update(definition).edges).toEqual(definition.edges.slice(1));
});

it("centers implicit cards of different widths while leaving legacy coordinates and measurement updates uncommitted", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  definition.layout = { start: { x: 17, y: 9 } };
  const before = structuredClone(definition);
  const onChange = vi.fn();
  const onNodeMeasurements = vi.fn();
  render(
    <WorkflowCanvas
      definition={definition}
      selected=""
      selectedEdge={null}
      onSelect={vi.fn()}
      onSelectEdge={vi.fn()}
      onChange={onChange}
      onProblem={vi.fn()}
      editable
      invalidNodes={new Set()}
      layoutRevision={0}
      onNodeMeasurements={onNodeMeasurements}
    />,
  );
  act(() =>
    flow.change?.([
      { id: "start", type: "dimensions", dimensions: { width: 160, height: 44 } },
      { id: "read", type: "dimensions", dimensions: { width: 240, height: 44 } },
      { id: "task", type: "dimensions", dimensions: { width: 180, height: 44 } },
    ]),
  );
  expect(flow.props.nodeOrigin).toEqual([0.5, 0.5]);
  const start = flow.nodes.find((node) => node.id === "start");
  expect(start?.origin).toEqual([0, 0]);
  expect(start?.position).toEqual({ x: 17, y: 9 });
  for (const id of ["read", "task"]) {
    const node = flow.nodes.find((item) => item.id === id);
    expect(node?.origin).toEqual([0.5, 0.5]);
    expect(node?.position.x).toBe(0);
  }
  expect(onNodeMeasurements).toHaveBeenLastCalledWith(
    new Map([
      ["start", { width: 160, height: 44 }],
      ["read", { width: 240, height: 44 }],
      ["task", { width: 180, height: 44 }],
    ]),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(definition).toEqual(before);
  act(() =>
    flow.change?.([{ id: "start", type: "position", position: { x: 27, y: 19 }, dragging: false }]),
  );
  const update = onChange.mock.calls[0]?.[0] as (graph: typeof definition) => typeof definition;
  expect(update(definition).layout?.start).toEqual({ x: 27, y: 19 });
});

it("opens output and pane insertion at measured centers without rewriting legacy positions", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  definition.layout = { task: { x: 200, y: 400 } };
  const onAdd = vi.fn();
  const onChange = vi.fn();
  render(
    <WorkflowCanvas
      definition={definition}
      selected=""
      selectedEdge={null}
      onSelect={vi.fn()}
      onSelectEdge={vi.fn()}
      onChange={onChange}
      onProblem={vi.fn()}
      editable
      invalidNodes={new Set()}
      layoutRevision={0}
      onAdd={onAdd}
    />,
  );
  act(() =>
    flow.change?.([{ id: "task", type: "dimensions", dimensions: { width: 180, height: 44 } }]),
  );
  act(() =>
    flow.nodes.find((node) => node.id === "task")?.data.onAdd?.({ from: "task", port: "next" }),
  );
  expect(onAdd).toHaveBeenLastCalledWith(
    { from: "task", port: "next" },
    { x: 290, y: 572, anchor: "center" },
  );
  const instance = {
    screenToFlowPosition: () => ({ x: 200, y: 600 }),
  } as unknown as ReactFlowInstance<CanvasNode, WorkflowCanvasEdge>;
  act(() => flow.props.onInit?.(instance));
  const pane = document.createElement("div");
  pane.className = "react-flow__pane";
  const event = new MouseEvent("mouseup", { clientX: 400, clientY: 600 });
  Object.defineProperty(event, "target", { value: pane });
  act(() =>
    flow.props.onConnectEnd?.(event, {
      isValid: false,
      fromHandle: { type: "source", id: "next", nodeId: "task" },
      toNode: null,
    } as FinalConnectionState),
  );
  expect(onAdd).toHaveBeenLastCalledWith(
    { from: "task", port: "next" },
    { x: 200, y: 600, anchor: "center" },
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(definition.layout).toEqual({ task: { x: 200, y: 400 } });
});

it("withholds canvas edge mutation controls from a read-only trace even when an add callback exists", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const onChange = vi.fn();
  render(
    <WorkflowCanvas
      definition={definition}
      selected="start"
      selectedEdge={null}
      onSelect={vi.fn()}
      onSelectEdge={vi.fn()}
      onChange={onChange}
      onProblem={vi.fn()}
      editable={false}
      invalidNodes={new Set()}
      layoutRevision={0}
      onAdd={vi.fn()}
      onChangeType={vi.fn()}
      onDuplicate={vi.fn()}
    />,
  );
  for (const edge of flow.props.edges ?? []) {
    expect(edge.data?.onInsert).toBeUndefined();
    expect(edge.data?.onDisconnect).toBeUndefined();
    expect(edge.deletable).toBe(false);
    expect(edge.reconnectable).toBe(false);
  }
  for (const node of flow.nodes) {
    expect(node.data.onConfigure).toBeUndefined();
    expect(node.data.onChangeType).toBeUndefined();
    expect(node.data.onDuplicate).toBeUndefined();
    expect(node.data.onRemove).toBeUndefined();
  }
  act(() => flow.change?.([{ id: "read", type: "remove" }]));
  expect(onChange).not.toHaveBeenCalled();
});

it("offers authorized node configuration and removal while protecting the trigger", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const onSelect = vi.fn();
  const onChangeType = vi.fn();
  const onDuplicate = vi.fn();
  const onChange = vi.fn();
  render(
    <WorkflowCanvas
      definition={definition}
      selected="start"
      selectedEdge={null}
      onSelect={onSelect}
      onChangeType={onChangeType}
      onDuplicate={onDuplicate}
      onSelectEdge={vi.fn()}
      onChange={onChange}
      onProblem={vi.fn()}
      editable
      invalidNodes={new Set()}
      layoutRevision={0}
    />,
  );
  const read = flow.nodes.find((node) => node.id === "read");
  act(() => read?.data.onConfigure?.());
  expect(onSelect).toHaveBeenLastCalledWith("read");
  act(() => read?.data.onChangeType?.());
  expect(onChangeType).toHaveBeenCalledWith("read");
  act(() => read?.data.onDuplicate?.());
  expect(onDuplicate).toHaveBeenCalledWith("read");
  expect(onChange).not.toHaveBeenCalled();
  expect(flow.nodes.find((node) => node.id === "start")?.data.onRemove).toBeUndefined();
  expect(flow.nodes.find((node) => node.id === "start")?.data.onDuplicate).toBeUndefined();
  act(() => read?.data.onRemove?.());
  expect(onChange).toHaveBeenCalledTimes(1);
  const update = onChange.mock.calls[0]?.[0] as (current: typeof definition) => typeof definition;
  expect(update(definition).nodes.map((node) => node.id)).toEqual(["start", "task"]);
  expect(update(definition).edges).toEqual([]);
  expect(onSelect).toHaveBeenLastCalledWith("");
});

it("clears node and edge selection after keyboard deletion instead of opening another inspector", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const onSelect = vi.fn();
  const onSelectEdge = vi.fn();
  const onChange = vi.fn();
  render(
    <WorkflowCanvas
      definition={definition}
      selected="read"
      selectedEdge={null}
      onSelect={onSelect}
      onSelectEdge={onSelectEdge}
      onChange={onChange}
      onProblem={vi.fn()}
      editable
      invalidNodes={new Set()}
      layoutRevision={0}
    />,
  );
  act(() => flow.change?.([{ id: "start", type: "remove" }]));
  expect(onChange).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  act(() => flow.change?.([{ id: "read", type: "remove" }]));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("");
  expect(onSelectEdge).toHaveBeenCalledExactlyOnceWith(null);
  const update = onChange.mock.calls[0]?.[0] as (graph: typeof definition) => typeof definition;
  expect(update(definition).nodes.map((node) => node.id)).toEqual(["start", "task"]);
});
