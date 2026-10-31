// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { NodeChange } from "@xyflow/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { CanvasNode } from "./WorkflowNodeCard";

const flow = vi.hoisted(() => ({
  nodes: [] as CanvasNode[],
  change: undefined as undefined | ((changes: NodeChange<CanvasNode>[]) => void),
}));
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: {
    nodes: CanvasNode[];
    onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  }) => {
    flow.nodes = props.nodes;
    flow.change = props.onNodesChange;
    return null;
  },
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom" },
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
