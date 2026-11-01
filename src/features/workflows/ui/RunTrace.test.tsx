// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { type RunDetail, RunTrace } from "./RunTrace";

vi.mock("./WorkflowCanvas", () => ({ WorkflowCanvas: () => <div>Graph</div> }));
afterEach(cleanup);
it("shows the pinned version, completed path and simulation meaning in German", () => {
  const detail: RunDetail = {
    id: crypto.randomUUID(),
    number: 2,
    status: "succeeded",
    mode: "simulation",
    errorId: null,
    nextNodeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    definition: initialDefinition({
      start: "Start",
      read: "Read",
      task: "Call customer",
      subject: "پیگیری مشتری",
    }),
    steps: [
      { nodeId: "start", completedAt: new Date(), simulated: false },
      { nodeId: "read", completedAt: new Date(), simulated: false },
      { nodeId: "task", completedAt: new Date(), simulated: true },
    ],
  };
  detail.definition.nodes[2]!.nameMode = "custom";
  render(
    <LocaleProvider locale="de">
      <RunTrace detail={detail} />
    </LocaleProvider>,
  );
  expect(screen.getByText("Veröffentlichte Version 2")).toBeDefined();
  expect(screen.getByRole("button", { name: /Call customer/ })).toBeDefined();
  expect(screen.getByText(/Keine Aufgabenänderungen wurden gespeichert/)).toBeDefined();
});
