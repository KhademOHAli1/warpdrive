// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Position } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowDiagramEdge } from "./WorkflowDiagramEdge";

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => children,
}));
afterEach(cleanup);

const base = {
  id: "start:next:read",
  type: "workflow",
  source: "start",
  target: "read",
  sourceX: 120,
  sourceY: 60,
  targetX: 120,
  targetY: 200,
  sourcePosition: Position.Bottom,
  targetPosition: Position.Top,
  data: { spec: { from: "start", port: "next", to: "read" } as const },
};

it("opens contextual insertion at the edge midpoint without disconnecting", () => {
  const onInsert = vi.fn();
  const onDisconnect = vi.fn();
  render(<WorkflowDiagramEdge {...base} data={{ ...base.data, onInsert, onDisconnect }} />);
  fireEvent.click(screen.getByRole("button", { name: "Insert a step here" }));
  expect(onInsert).toHaveBeenCalledWith({ x: 120, y: 130 });
  expect(onDisconnect).not.toHaveBeenCalled();
});

it("disconnects only through the supplied action", () => {
  const onDisconnect = vi.fn();
  render(<WorkflowDiagramEdge {...base} data={{ ...base.data, onDisconnect }} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove connection" }));
  expect(onDisconnect).toHaveBeenCalledTimes(1);
});

it("renders a read-only edge without insertion or deletion controls", () => {
  render(<WorkflowDiagramEdge {...base} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
