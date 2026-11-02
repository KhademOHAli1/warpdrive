// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FinalConnectionState } from "@xyflow/react";
import { afterEach, expect, it, vi } from "vitest";
import { initialDefinition } from "../editorModel";
import { useConnectionGestures } from "./useConnectionGestures";

afterEach(cleanup);
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
