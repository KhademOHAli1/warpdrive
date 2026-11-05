// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import english from "../messages/workflows.en.json";
import type { PickerSelection } from "../paletteContext";
import { NodePalette } from "./NodePalette";
import { paletteDefinition, readyPaletteRead } from "./palette.TestHelpers";
import { buildPaletteView } from "./paletteView";

afterEach(cleanup);

function callbacks() {
  return {
    onChoose: vi.fn<(selection: PickerSelection) => void>(),
    onClose: vi.fn<() => void>(),
  };
}
function palette(
  handlers: ReturnType<typeof callbacks>,
  { open = true, trigger = false, occupied = false } = {},
) {
  const definition = paletteDefinition();
  definition.nodes.push({
    id: "review",
    type: "condition",
    version: 1,
    name: "Review",
    nameMode: "custom",
    config: {
      left: { kind: "reference", nodeId: "start", path: ["recordId"] },
      operator: "exists",
    },
  });
  definition.edges.push({ from: "start", to: "review", port: "next" });
  if (occupied) {
    definition.nodes.push({
      id: "read",
      type: "record.read",
      version: 1,
      name: "Read",
      config: {},
    });
    definition.edges.push({ from: "review", to: "read", port: "true" });
  }
  const model = buildPaletteView(
    definition,
    trigger
      ? { kind: "replace", nodeId: "start" }
      : { kind: "output", output: { from: "review", port: "true" } },
    readyPaletteRead(),
    true,
  );
  return (
    <LocaleProvider locale="en">
      <NodePalette open={open} {...handlers} model={model} />
    </LocaleProvider>
  );
}

it("keeps action descriptions and source context accessible in the compact picker", async () => {
  const handlers = callbacks();
  const user = userEvent.setup();
  render(palette(handlers));
  const dialog = screen.getByRole("dialog", { name: english.selectAction });
  expect(dialog).toHaveAccessibleDescription(
    expect.stringContaining(`Review · ${english.truePort}`),
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  for (const label of [english.read, english.task, english.condition, english.delay]) {
    expect(within(dialog).getByRole("button", { name: label })).toBeVisible();
  }
  const read = within(dialog).getByRole("button", { name: english.read });
  expect(read).toHaveAccessibleDescription(expect.stringContaining(english.readActionHint));
  expect(handlers.onChoose).not.toHaveBeenCalled();
  await user.click(read);
  expect(handlers.onChoose).toHaveBeenCalledExactlyOnceWith({
    kind: "insert",
    type: "record.read",
    version: 1,
  });
  expect(handlers.onClose).not.toHaveBeenCalled();
});

it("dismisses with the named close control without inserting a node", async () => {
  const handlers = callbacks();
  const user = userEvent.setup();
  render(palette(handlers));
  await user.click(screen.getByRole("button", { name: english.close }));
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
  expect(handlers.onChoose).not.toHaveBeenCalled();
});

it("retains controlled open and real shared-dialog Escape close behavior", async () => {
  const handlers = callbacks();
  const user = userEvent.setup();
  const mounted = render(palette(handlers, { open: false }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mounted.rerender(palette(handlers));
  expect(screen.getByRole("dialog", { name: english.selectAction })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
  mounted.rerender(palette(handlers, { open: false }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(handlers.onChoose).not.toHaveBeenCalled();
});

it("groups action choices under Data, Flow and Core while withholding triggers", () => {
  const handlers = callbacks();
  render(palette(handlers));
  for (const category of [
    english.nodeCategoryData,
    english.nodeCategoryFlow,
    english.nodeCategoryCore,
  ]) {
    expect(screen.getByRole("heading", { name: category })).toBeVisible();
  }
  expect(
    screen.queryByRole("heading", { name: english.nodeCategoryTrigger }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: english.paletteManual })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: english.paletteRecordTrigger }),
  ).not.toBeInTheDocument();
  expect(handlers.onChoose).not.toHaveBeenCalled();
});

it("explains a structural insertion restriction and keeps the safe linear action available", async () => {
  const handlers = callbacks();
  const user = userEvent.setup();
  render(palette(handlers, { occupied: true }));
  const condition = screen.getByRole("button", { name: english.condition });
  expect(condition).toHaveAttribute("aria-disabled", "true");
  expect(condition).toHaveAccessibleDescription(expect.stringContaining(english.paletteLinearOnly));
  await user.click(condition);
  fireEvent.click(condition);
  expect(handlers.onChoose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: english.delay }));
  expect(handlers.onChoose).toHaveBeenCalledExactlyOnceWith({
    kind: "insert",
    type: "delay",
    version: 1,
  });
});

it.each([
  { label: "record-change trigger", title: english.paletteRecordTrigger, trigger: true },
  { label: "notification", title: english.notification, trigger: false },
])(
  "keeps the known unsupported $label discoverable with a safe explanation",
  async ({ title, trigger }) => {
    const handlers = callbacks();
    const user = userEvent.setup();
    render(palette(handlers, { trigger }));
    const dialog = screen.getByRole("dialog", {
      name: trigger ? english.selectTrigger : english.selectAction,
    });
    const action = within(dialog).getByRole("button", { name: title });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveAccessibleDescription(expect.stringContaining(english.paletteUnavailable));
    expect(within(action).getByText(`· ${english.paletteUnavailable}`)).toBeVisible();
    await user.click(action);
    expect(handlers.onChoose).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(dialog).toBeVisible();
  },
);
