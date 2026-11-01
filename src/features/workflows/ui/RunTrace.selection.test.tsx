// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "@/features/workflows/editorModel";
import { type RunDetail, RunTrace } from "@/features/workflows/ui/RunTrace";

vi.mock("@/features/workflows/ui/WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas omitted from selected-step semantics regression</div>,
}));
afterEach(cleanup);

it("exposes the selected historical step and updates its accessible state by keyboard", async () => {
  const definition = initialDefinition({
    start: "Starting point",
    read: "Review record",
    task: "Contact customer",
    subject: "Call",
  });
  for (const node of definition.nodes) node.nameMode = "custom";
  const detail: RunDetail = {
    id: "8755a40e-fda9-4456-a3f4-7f6ff73a0eea",
    number: 1,
    status: "succeeded",
    mode: "simulation",
    errorId: null,
    nextNodeId: null,
    createdAt: new Date("2026-10-31T12:00:00Z"),
    updatedAt: new Date("2026-10-31T12:00:00Z"),
    definition,
    steps: [],
  };
  render(
    <LocaleProvider locale="en">
      <RunTrace detail={detail} />
    </LocaleProvider>,
  );
  const first = screen.getByRole("button", { name: /Starting point/ });
  const second = screen.getByRole("button", { name: /Review record/ });
  const user = userEvent.setup();
  second.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Review record" })).toBeInTheDocument();
  expect(second).toHaveAttribute("aria-pressed", "true");
  expect(first).toHaveAttribute("aria-pressed", "false");
});
