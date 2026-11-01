// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { NodeSummary } from "./NodeSummary";

afterEach(cleanup);
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
