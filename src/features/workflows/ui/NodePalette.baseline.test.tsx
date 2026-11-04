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
function palette(handlers: ReturnType<typeof callbacks>, open = true) {
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
  const model = buildPaletteView(
    definition,
    { kind: "output", output: { from: "review", port: "true" } },
    readyPaletteRead(),
    true,
  );
  return (
    <LocaleProvider locale="en">
      <NodePalette open={open} {...handlers} model={model} />
    </LocaleProvider>
  );
}

it("retains current labels, descriptions, localized search and supported selection", async () => {
  const handlers = callbacks();
  const user = userEvent.setup();
  render(palette(handlers));
  expect(screen.getByText(`Review · ${english.truePort}`)).toBeVisible();
  for (const label of [english.read, english.task, english.condition, english.delay]) {
    expect(screen.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }
  expect(screen.getByText(english.readActionHint)).toBeVisible();
  await user.type(screen.getByRole("textbox", { name: english.searchNodes }), "selected deal");
  expect(screen.getByRole("button", { name: new RegExp(english.read) })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: new RegExp(english.condition) }),
  ).not.toBeInTheDocument();
  expect(handlers.onChoose).not.toHaveBeenCalled();
  expect(handlers.onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: new RegExp(english.read) }));
  expect(handlers.onChoose).toHaveBeenCalledTimes(1);
  expect(handlers.onChoose).toHaveBeenCalledWith({
    kind: "insert",
    type: "record.read",
    version: 1,
  });
});

it("retains no-results feedback and Clear without inserting a node", async () => {
  const handlers = callbacks();
  const user = userEvent.setup();
  render(palette(handlers));
  await user.type(screen.getByRole("textbox", { name: english.searchNodes }), "no-such-action-675");
  expect(screen.getByRole("status")).toHaveTextContent(english.noNodes);
  await user.click(screen.getByRole("button", { name: english.clearSearch }));
  expect(screen.getByRole("textbox", { name: english.searchNodes })).toHaveValue("");
  expect(screen.getByRole("button", { name: new RegExp(english.task) })).toBeVisible();
  expect(handlers.onChoose).not.toHaveBeenCalled();
  expect(handlers.onClose).not.toHaveBeenCalled();
});

it("retains controlled open and real shared-dialog Escape close behavior", async () => {
  const handlers = callbacks();
  const user = userEvent.setup();
  const mounted = render(palette(handlers, false));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mounted.rerender(palette(handlers));
  expect(screen.getByRole("dialog", { name: english.chooseNode })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
  mounted.rerender(palette(handlers, false));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(handlers.onChoose).not.toHaveBeenCalled();
});

it("groups the reviewed catalog under discoverable category headings", () => {
  const handlers = callbacks();
  render(palette(handlers));
  // Existing choices are setup controls, preceding the new missing-behavior assertion.
  expect(screen.getByRole("button", { name: new RegExp(english.read) })).toBeVisible();
  for (const category of ["CRM", "Logic", "Timing", "Triggers"]) {
    expect(screen.getByRole("heading", { name: category })).toBeVisible();
  }
  expect(handlers.onChoose).not.toHaveBeenCalled();
});

it("finds an action by its localized category rather than only its title or description", async () => {
  const handlers = callbacks();
  const user = userEvent.setup();
  render(palette(handlers));
  expect(screen.getByRole("button", { name: new RegExp(english.delay) })).toBeVisible();
  await user.type(screen.getByRole("textbox", { name: english.searchNodes }), "Timing");
  expect(screen.getByRole("button", { name: new RegExp(english.delay) })).toBeVisible();
  expect(screen.queryByText(english.noNodes)).not.toBeInTheDocument();
  expect(handlers.onChoose).not.toHaveBeenCalled();
});

it.each([
  {
    label: "record-change trigger",
    query: "record",
    title: /^(?:record (?:change|changed|changes)(?: trigger)?|when a record changes)$/i,
    button: /record (?:change|changed|changes)(?: trigger)?/i,
  },
  {
    label: "notification",
    query: english.notification,
    title: /^Notification$/i,
    button: /Notification/i,
  },
])(
  "keeps the known unsupported $label discoverable with a safe unavailable explanation",
  async ({ query, title, button }) => {
    const handlers = callbacks();
    const user = userEvent.setup();
    render(palette(handlers));
    expect(screen.getByRole("dialog", { name: english.chooseNode })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: english.searchNodes }), {
      target: { value: query },
    });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(title)).toBeVisible();
    expect(within(dialog).getByText(english.paletteUnavailable)).toBeVisible();
    // Static entries and guarded/disabled buttons are both valid presentation choices.
    const action = within(dialog).queryByRole("button", { name: button });
    if (action !== null) await user.click(action);
    expect(handlers.onChoose).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(dialog).toBeVisible();
  },
);
