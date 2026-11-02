// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import type { Binding, WorkflowNode } from "../schemas";
import { NodeSummary } from "./NodeSummary";

afterEach(cleanup);

function delayNode(minutes: Binding): WorkflowNode {
  return {
    id: "wait",
    type: "delay",
    version: 1,
    name: "Wait",
    config: { minutes },
  };
}

it.each([
  ["en", "Wait (minutes): 60"],
  ["fa", "انتظار (دقیقه): ۶۰"],
  ["de", "Wartezeit (Minuten): 60"],
] as const)("summarizes a literal duration in %s", (locale, summary) => {
  render(
    <LocaleProvider locale={locale}>
      <NodeSummary node={delayNode({ kind: "value", value: 60 })} />
    </LocaleProvider>,
  );
  expect(screen.getByText(summary)).toBeDefined();
});

it("uses the account numbering preference independently of Persian language", () => {
  render(
    <LocaleProvider locale="fa" numberingSystem="latn">
      <NodeSummary node={delayNode({ kind: "value", value: 60 })} />
    </LocaleProvider>,
  );
  expect(screen.getByText("انتظار (دقیقه): 60")).toBeDefined();
});

it.each([-1, "60"])("does not summarize invalid duration %j as executable minutes", (value) => {
  render(
    <LocaleProvider locale="en">
      <NodeSummary node={delayNode({ kind: "value", value })} />
    </LocaleProvider>,
  );
  expect(screen.getByText("Setup required")).toBeDefined();
});

it("explains that a mapped duration needs a fixed literal", () => {
  render(
    <LocaleProvider locale="en">
      <NodeSummary node={delayNode({ kind: "reference", nodeId: "read", path: ["value"] })} />
    </LocaleProvider>,
  );
  expect(
    screen.getByText("Mapped durations are not available. Enter a fixed number of minutes."),
  ).toBeDefined();
});

it("keeps user task text intact and translates condition fields and statuses", () => {
  const task = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "تماس با مشتری",
  }).nodes[2]!;
  const view = render(
    <LocaleProvider locale="de">
      <NodeSummary node={task} />
    </LocaleProvider>,
  );
  expect(screen.getByText("تماس با مشتری")).toBeDefined();
  const condition = {
    ...task,
    type: "condition" as const,
    config: {
      left: { kind: "reference", nodeId: "read", path: ["status"] },
      operator: "equals",
      right: { kind: "value", value: "won" },
    },
  };
  view.rerender(
    <LocaleProvider locale="fa">
      <NodeSummary node={condition} />
    </LocaleProvider>,
  );
  expect(screen.getByText(/وضعیت معامله/)).toBeDefined();
  expect(screen.queryByText(/won/)).toBeNull();
});
