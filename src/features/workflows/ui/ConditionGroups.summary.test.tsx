// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NodeProps, ReactFlowProps } from "@xyflow/react";
import { afterEach, assert, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import copy from "../messages/workflows.en.json";
import type { WorkflowNode } from "../schemas";
import { ConnectionEditor } from "./ConnectionEditor";
import {
  fixture,
  GroupLocaleProvider,
  group,
  grouped,
  groupLocales,
  englishGroups as labels,
  literal,
  predicate,
  prepareGroupDom,
  reference,
} from "./conditionGroups.TestHelpers";
import { EdgeInspector } from "./EdgeInspector";
import { NodeSummary } from "./NodeSummary";
import { type RunDetail, RunTrace } from "./RunTrace";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { type CanvasNode, WorkflowNodeCard } from "./WorkflowNodeCard";

const flow = vi.hoisted(() => {
  const props: ReactFlowProps<CanvasNode> = {};
  return { props };
});
// The renderer is replaced only to observe real canvas label props. Card/editor/trace/summary remain real.
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: ReactFlowProps<CanvasNode>) => {
    flow.props = props;
    return null;
  },
  Background: () => null,
  Controls: () => null,
  Handle: ({ id, "aria-label": label }: { id?: string; "aria-label"?: string }) => (
    <span role="img" data-testid={"handle-" + id} aria-label={label} />
  ),
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom" },
  ConnectionLineType: { SmoothStep: "smoothstep" },
  useConnection: () => ({ inProgress: false }),
}));
beforeAll(prepareGroupDom);
afterEach(cleanup);
function presenceFixture() {
  return fixture(
    grouped([
      predicate("null_value", reference("value"), "equals", literal(null)),
      group("alternatives", "or", [
        predicate("empty_title", reference("title"), "equals", literal("")),
        predicate("omitted_title", reference("title"), "equals"),
        predicate("invalid_number", literal(1), "equals", {
          kind: "value",
          value: "-",
          literalType: "number",
        }),
      ]),
    ]),
  );
}
it.each(groupLocales)(
  "summarizes precedence and distinct presence states with selected display preferences in $name",
  async (context) => {
    const test = presenceFixture();
    const before = JSON.stringify(test.definition);
    const mounted = render(
      <GroupLocaleProvider context={context}>
        <NodeSummary node={test.node} definition={test.definition} />
      </GroupLocaleProvider>,
    );
    expect(mounted.container).toHaveTextContent(
      new Intl.NumberFormat(context.locale, { numberingSystem: context.numberingSystem }).format(4),
    );
    const expand = screen.getByRole("button", { name: context.groups.expand });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(expand);
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(mounted.container).toHaveTextContent(context.groups.all);
    expect(mounted.container).toHaveTextContent(context.groups.any);
    expect(mounted.container).toHaveTextContent(context.copy.configurationNullValue);
    expect(mounted.container).toHaveTextContent(context.groups.empty);
    expect(mounted.container).toHaveTextContent(context.groups.omitted);
    expect(mounted.container).toHaveTextContent(context.groups.invalid);
    expect(mounted.container.textContent).toMatch(/[()]/);
    expect(mounted.container).toHaveTextContent("Read opportunity");
    expect(mounted.container).not.toHaveTextContent("expression.children");
    expect(mounted.container).not.toHaveTextContent("null_value");
    const direction = context.locale === "fa" ? "rtl" : "ltr";
    expect(expand.closest("[dir]")).toHaveAttribute("dir", direction);
    expect(JSON.stringify(test.definition)).toBe(before);
  },
);
function card(node: WorkflowNode): NodeProps<CanvasNode> {
  return {
    id: node.id,
    type: "workflow",
    data: { node, invalid: false, index: 2, outputs: ["true", "false"] },
    selected: false,
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
it("uses the same Otherwise default caption on real editors/card, canvas label props and pinned trace without changing wire or fetching values", async () => {
  const test = fixture();
  const before = JSON.stringify(test.definition);
  const changed = vi.fn();
  const problem = vi.fn();
  const user = userEvent.setup();
  const edge = test.definition.edges.find((item) => item.from === "check" && item.port === "false");
  assert(edge !== undefined);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected condition preview request"));
  try {
    const connection = render(
      <LocaleProvider locale="en">
        <ConnectionEditor
          definition={test.definition}
          node={test.node}
          editable
          onChange={changed}
          onProblem={problem}
        />
      </LocaleProvider>,
    );
    expect(
      within(connection.container).getByRole("combobox", { name: labels.otherwise }),
    ).toHaveTextContent("Default path");
    connection.unmount();
    const inspected = render(
      <LocaleProvider locale="en">
        <EdgeInspector
          definition={test.definition}
          edge={edge}
          editable
          onChange={changed}
          onProblem={problem}
          onClose={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(
      within(inspected.container).getByRole("combobox", { name: copy.connectionPort }),
    ).toHaveTextContent(labels.otherwise);
    inspected.unmount();
    const renderedCard = render(
      <LocaleProvider locale="en">
        <WorkflowNodeCard {...card(test.node)} />
      </LocaleProvider>,
    );
    expect(renderedCard.container).toHaveTextContent(labels.otherwise);
    expect(within(renderedCard.container).getByTestId("handle-false")).toHaveAttribute(
      "aria-label",
      labels.otherwise,
    );
    renderedCard.unmount();
    const canvas = render(
      <LocaleProvider locale="en">
        <WorkflowCanvas
          definition={test.definition}
          selected="check"
          selectedEdge={null}
          onSelect={vi.fn()}
          onSelectEdge={vi.fn()}
          onChange={changed}
          onProblem={problem}
          editable={false}
          invalidNodes={new Set()}
          layoutRevision={0}
        />
      </LocaleProvider>,
    );
    expect(
      flow.props.edges?.find((item) => item.source === "check" && item.sourceHandle === "false")
        ?.label,
    ).toBe(labels.otherwise);
    expect(flow.props.edges?.map((item) => item.sourceHandle)).toEqual([
      "next",
      "next",
      "true",
      "false",
    ]);
    canvas.unmount();
    const detail: RunDetail = {
      id: "e901b577-47fb-4899-90f1-02987918facb",
      number: 7,
      status: "succeeded",
      mode: "simulation",
      resumeAt: null,
      errorId: null,
      nextNodeId: null,
      createdAt: new Date("2026-11-04T12:00:00Z"),
      updatedAt: new Date("2026-11-04T12:00:00Z"),
      definition: test.definition,
      steps: [
        { nodeId: "start", completedAt: new Date("2026-11-04T12:00:01Z"), simulated: true },
        { nodeId: "read", completedAt: new Date("2026-11-04T12:00:02Z"), simulated: true },
        { nodeId: "check", completedAt: new Date("2026-11-04T12:00:03Z"), simulated: true },
      ],
    };
    const trace = render(
      <LocaleProvider locale="en">
        <RunTrace detail={detail} />
      </LocaleProvider>,
    );
    await user.click(
      within(screen.getByRole("list", { name: copy.steps })).getByRole("button", {
        name: /Qualify opportunity/,
      }),
    );
    expect(trace.container).toHaveTextContent(labels.all);
    expect(flow.props.edges?.find((item) => item.sourceHandle === "false")?.label).toBe(
      labels.otherwise,
    );
    expect(trace.container).not.toHaveTextContent("actualCustomerRecord");
    expect(screen.queryByRole("button", { name: labels.convert })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(problem).not.toHaveBeenCalled();
    expect(JSON.stringify(test.definition)).toBe(before);
  } finally {
    fetch.mockRestore();
  }
});
it("escapes authored text and safely summarizes malformed structured literals without coercion, disclosure or preview fetch", async () => {
  const authored = '<img src=x onerror="window.conditionInjected=true">';
  const escaped = fixture(
    grouped([predicate("escaped", reference("title"), "equals", literal(authored))]),
  );
  const test = fixture(
    grouped([
      predicate("unsafe_value", reference("title"), "equals", {
        kind: "value",
        value: { privatePayload: "actualCustomerRecord" },
      }),
    ]),
  );
  const before = JSON.stringify(test.definition);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected condition preview request"));
  try {
    const escapedView = render(
      <LocaleProvider locale="en">
        <NodeSummary node={escaped.node} definition={escaped.definition} />
      </LocaleProvider>,
    );
    expect(escapedView.container).toHaveTextContent(authored);
    expect(escapedView.container.querySelector("img")).toBeNull();
    escapedView.unmount();
    const view = render(
      <LocaleProvider locale="en">
        <NodeSummary node={test.node} definition={test.definition} />
      </LocaleProvider>,
    );
    expect(view.container).toHaveTextContent(labels.invalid);
    expect(view.container).not.toHaveTextContent("[object Object]");
    expect(view.container).not.toHaveTextContent("actualCustomerRecord");
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(test.definition)).toBe(before);
  } finally {
    fetch.mockRestore();
  }
});
