// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FinalConnectionState } from "@xyflow/react";
import { afterEach, expect, it, vi } from "vitest";
import { initialDefinition } from "../editorModel";
import { branchPort, newIfElseBranch, newIfElseConfig } from "../ifElse";
import { useConnectionGestures } from "./useConnectionGestures";

afterEach(cleanup);

it("connects a named If/Else route and opens insertion only for a configured free route", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const config = newIfElseConfig();
  config.branches.push(newIfElseBranch("middle"));
  definition.nodes.push({ id: "switch", type: "ifElse", name: "If/Else", version: 1, config });
  definition.edges = [
    { from: "start", to: "read", port: "next" },
    { from: "read", to: "switch", port: "next" },
  ];
  const onAdd = vi.fn();
  const onChange = vi.fn();
  const { result } = renderHook(() =>
    useConnectionGestures({
      definition,
      editable: true,
      onAdd,
      onChange,
      onProblem: vi.fn(),
      onSelectEdge: vi.fn(),
    }),
  );
  const connection = {
    source: "switch",
    target: "task",
    sourceHandle: branchPort("if"),
    targetHandle: "in",
  };
  expect(result.current.isValidConnection(connection)).toBe(true);
  expect(result.current.isValidConnection({ ...connection, sourceHandle: "branch:foreign" })).toBe(
    false,
  );
  act(() => result.current.connect(connection));
  expect(onChange.mock.calls[0]?.[0].edges).toContainEqual({
    from: "switch",
    to: "task",
    port: "branch:if",
  });

  act(() => result.current.initialize({ screenToFlowPosition: () => ({ x: 150, y: 330 }) }));
  const pane = document.createElement("div");
  pane.className = "react-flow__pane";
  const event = new MouseEvent("mouseup");
  Object.defineProperty(event, "target", { value: pane });
  function drop(id: string) {
    const state = {
      isValid: false,
      fromHandle: { type: "source", id, nodeId: "switch" },
      toNode: null,
    } as FinalConnectionState;
    act(() => result.current.finish(event, state));
  }
  drop("branch:foreign");
  drop("branch:middle");
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(
    { from: "switch", port: "branch:middle" },
    { x: 150, y: 330 },
  );
});
it("opens the contextual picker only when a free source is dropped on empty canvas", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const onAdd = vi.fn();
  const { result } = renderHook(() =>
    useConnectionGestures({
      definition,
      editable: true,
      onAdd,
      onChange: vi.fn(),
      onProblem: vi.fn(),
      onSelectEdge: vi.fn(),
    }),
  );
  act(() => result.current.initialize({ screenToFlowPosition: () => ({ x: 200, y: 600 }) }));
  const pane = document.createElement("div");
  pane.className = "react-flow__pane";
  const event = new MouseEvent("mouseup", { clientX: 400, clientY: 600 });
  Object.defineProperty(event, "target", { value: pane });
  const state = {
    isValid: false,
    fromHandle: { type: "source", id: "next", nodeId: "task" },
    toNode: null,
  } as FinalConnectionState;
  act(() => result.current.finish(event, state));
  expect(onAdd).toHaveBeenCalledWith({ from: "task", port: "next" }, { x: 200, y: 600 });
  onAdd.mockClear();
  act(() =>
    result.current.finish(event, {
      ...state,
      fromHandle: { ...state.fromHandle!, nodeId: "read" },
    } as FinalConnectionState),
  );
  expect(onAdd).not.toHaveBeenCalled();
  act(() => result.current.startReconnect(definition.edges[1]));
  act(() => result.current.finish(event, state));
  expect(onAdd).not.toHaveBeenCalled();
});
it("accepts a free destination card as a drop target without requiring a precise port hit", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  definition.nodes.push({ ...definition.nodes[2]!, id: "extra" });
  const onChange = vi.fn();
  const { result } = renderHook(() =>
    useConnectionGestures({
      definition,
      editable: true,
      onChange,
      onAdd: vi.fn(),
      onProblem: vi.fn(),
      onSelectEdge: vi.fn(),
    }),
  );
  const card = document.createElement("div");
  card.className = "react-flow__node";
  card.dataset.id = "extra";
  const event = new MouseEvent("mouseup");
  Object.defineProperty(event, "target", { value: card });
  const state = {
    isValid: false,
    fromHandle: { type: "source", id: "next", nodeId: "task" },
    toNode: null,
    toHandle: null,
  } as FinalConnectionState;
  act(() => result.current.finish(event, state));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0]?.[0].edges).toContainEqual({
    from: "task",
    to: "extra",
    port: "next",
  });
});
