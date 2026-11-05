// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NodeChange } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import type { KpiGraph } from "@/features/goals/kpiModel";
import { KpiGraphCanvas } from "./KpiGraphCanvas";

interface FlowProps {
  children: ReactNode;
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeClick: (event: unknown, node: { id: string }) => void;
}
const flow = vi.hoisted(() => ({ current: undefined as FlowProps | undefined }));
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: FlowProps) => {
    flow.current = props;
    return (
      <div>
        <Button
          className="react-flow__node"
          data-id="result"
          onClick={(event) => props.onNodeClick(event, { id: "result" })}
        >
          Result node
        </Button>
        {props.children}
      </div>
    );
  },
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  ConnectionLineType: { SmoothStep: "smoothstep" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom" },
}));
vi.mock("@/features/workflows/ui/ResponsiveViewport", () => ({ ResponsiveViewport: () => null }));
const graph: KpiGraph = {
  version: 1,
  nodes: [
    { id: "value", type: "constant", value: "1", label: "Value", position: { x: 0, y: 0 } },
    { id: "result", type: "output", label: "Result", position: { x: 0, y: 180 } },
  ],
  edges: [{ id: "edge", source: "value", target: "result", targetHandle: "value" }],
  outputNodeId: "result",
};
afterEach(() => {
  cleanup();
  flow.current = undefined;
});

describe("KPI canvas selection", () => {
  it("ignores delayed controlled selection feedback while preserving explicit node clicks", () => {
    const onSelect = vi.fn();
    render(
      <KpiGraphCanvas
        graph={graph}
        selected="result"
        onSelect={onSelect}
        onChange={vi.fn()}
        onConnect={vi.fn()}
        isValidConnection={() => true}
        disabled={false}
        invalidNodes={new Set()}
        layoutRevision={0}
        reveal={undefined}
      />,
    );
    act(() => {
      flow.current?.onNodesChange([{ id: "value", type: "select", selected: true }]);
    });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Result node" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("result");
  });
  it("lets Enter select a focused canvas node without using reconciliation events", () => {
    const onSelect = vi.fn();
    render(
      <KpiGraphCanvas
        graph={graph}
        selected="value"
        onSelect={onSelect}
        onChange={vi.fn()}
        onConnect={vi.fn()}
        isValidConnection={() => true}
        disabled={false}
        invalidNodes={new Set()}
        layoutRevision={0}
        reveal={undefined}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Result node" }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("result");
  });
});
