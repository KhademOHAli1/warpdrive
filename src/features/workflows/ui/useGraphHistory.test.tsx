// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { initialDefinition } from "../editorModel";
import { moveNode, removeNode } from "../graphEditor";
import { useGraphHistory } from "./useGraphHistory";

afterEach(cleanup);
it("undoes deletion with connections, mappings and positions intact and discards redo after a new edit", () => {
  const initial = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const { result } = renderHook(() => useGraphHistory(initial));
  act(() => result.current.setDefinition((graph) => moveNode(graph, "read", { x: 320, y: 240 })));
  const moved = result.current.definition;
  act(() => result.current.setDefinition((graph) => removeNode(graph, "read")));
  act(() => result.current.undo());
  expect(result.current.definition).toEqual(moved);
  act(() => result.current.undo());
  expect(result.current.definition).toEqual(initial);
  act(() => result.current.redo());
  expect(result.current.definition).toEqual(moved);
  act(() => result.current.setDefinition((graph) => moveNode(graph, "task", { x: 640, y: 480 })));
  expect(result.current.canRedo).toBe(false);
});
it("ignores no-ops, bounds history, and keeps undo available after server normalization", () => {
  const initial = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const { result } = renderHook(() => useGraphHistory(initial));
  act(() => result.current.setDefinition(structuredClone(initial)));
  expect(result.current.canUndo).toBe(false);
  for (let i = 1; i <= 55; i++)
    act(() => result.current.setDefinition((graph) => moveNode(graph, "task", { x: i, y: 480 })));
  const normalized = structuredClone(result.current.definition);
  normalized.nodes[2]!.name = "Normalized";
  act(() => result.current.adopt(normalized));
  expect(result.current.definition.nodes[2]?.name).toBe("Normalized");
  for (let i = 0; i < 50; i++) act(() => result.current.undo());
  expect(result.current.canUndo).toBe(false);
  expect(result.current.definition.layout?.task?.x).toBe(5);
});
