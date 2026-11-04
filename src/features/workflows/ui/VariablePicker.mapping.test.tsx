// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import { BindingField } from "./BindingField";
import {
  completeMappingMetadata,
  MappingLocale,
  mappingGraph,
  mappingLocales,
  mappingTarget,
  prepareMappingDom,
} from "./mapping.TestHelpers";
import { buildMappingPickerModel } from "./mappingView";
import { VariablePicker } from "./VariablePicker";

beforeAll(prepareMappingDom);
afterEach(cleanup);
const reference = { kind: "reference" as const, nodeId: "read", path: ["title"] };

it.each(mappingLocales)("searches and selects a real typed source in $name", async (context) => {
  const graph = mappingGraph();
  const before = structuredClone(graph);
  const chosen = vi.fn();
  const model = buildMappingPickerModel(
    graph,
    "task",
    mappingTarget(graph),
    reference,
    completeMappingMetadata,
    true,
  );
  render(
    <MappingLocale context={context}>
      <VariablePicker open model={model} onChoose={chosen} onClose={vi.fn()} />
    </MappingLocale>,
  );
  const dialog = screen.getByRole("dialog", { name: context.copy.mappingPickerTitle });
  fireEvent.change(within(dialog).getByRole("textbox", { name: context.copy.mappingSearch }), {
    target: { value: "Opportunity read" },
  });
  const row = within(dialog).getByRole("button", { name: new RegExp(context.copy.fields.title) });
  expect(row).toHaveTextContent("Opportunity read");
  expect(row).toHaveTextContent(context.copy.mappingTypes.text);
  await userEvent.setup().click(row);
  expect(chosen).toHaveBeenCalledExactlyOnceWith(reference);
  expect(graph).toEqual(before);
});

it.each(mappingLocales)(
  "renders an inspectable source chip and labeled synthetic preview in $name",
  async (context) => {
    const graph = mappingGraph();
    const changed = vi.fn();
    render(
      <MappingLocale context={context}>
        <BindingField
          definition={graph}
          nodeId="task"
          value={reference}
          onChange={changed}
          kind="text"
          label={context.copy.subjectLabel}
          sourceLabel={context.copy.subjectSource}
          editable
          target={mappingTarget(graph)}
          metadata={completeMappingMetadata}
        />
      </MappingLocale>,
    );
    const chip = screen.getByRole("group", { name: context.copy.mappingChipLabel });
    expect(chip).toHaveTextContent("Opportunity read");
    expect(chip).toHaveTextContent(context.copy.fields.title);
    expect(chip).toHaveTextContent(context.copy.mappingTypes.text);
    const preview = screen.getByRole("region", { name: context.copy.mappingPreviewTitle });
    expect(within(preview).getByText(context.copy.mappingSynthetic)).toBeInTheDocument();
    expect(preview).toHaveTextContent(context.copy.mappingFutureValue);
    await userEvent
      .setup()
      .click(within(chip).getByRole("button", { name: context.copy.mappingInspect }));
    expect(preview).toHaveFocus();
    expect(changed).not.toHaveBeenCalled();
  },
);

function ReadonlyPicker({
  context,
  chosen,
}: {
  context: (typeof mappingLocales)[number];
  chosen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const graph = mappingGraph();
  const model = buildMappingPickerModel(
    graph,
    "task",
    mappingTarget(graph),
    reference,
    completeMappingMetadata,
    false,
  );
  return (
    <MappingLocale context={context}>
      <Button ref={opener} onClick={() => setOpen(true)}>
        Open choices
      </Button>
      <VariablePicker
        open={open}
        model={model}
        onChoose={chosen}
        onClose={() => setOpen(false)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
      />
    </MappingLocale>
  );
}
it.each(mappingLocales)(
  "keeps readonly source choices inspectable and restores focus on Escape in $name",
  async (context) => {
    const chosen = vi.fn();
    render(<ReadonlyPicker context={context} chosen={chosen} />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Open choices" });
    await user.click(opener);
    const row = screen.getByRole("button", { name: new RegExp(context.copy.fields.title) });
    expect(row).toHaveAttribute("aria-disabled", "true");
    row.focus();
    await user.keyboard("{Enter}");
    expect(chosen).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  },
);

it("labels an incomplete supported source while keeping its future schema selectable", async () => {
  const context = mappingLocales[0];
  const graph = mappingGraph();
  const source = graph.nodes.find((node) => node.id === "read");
  expect(source).toBeDefined();
  if (source === undefined) return;
  delete source.config.recordId;
  const chosen = vi.fn();
  const model = buildMappingPickerModel(
    graph,
    "task",
    mappingTarget(graph),
    reference,
    completeMappingMetadata,
    true,
  );
  render(
    <MappingLocale context={context}>
      <VariablePicker open model={model} onChoose={chosen} onClose={vi.fn()} />
    </MappingLocale>,
  );
  const row = screen.getByRole("button", { name: new RegExp(context.copy.fields.title) });
  expect(row).toHaveTextContent(context.copy.mappingNeedsConfiguration);
  expect(row).toHaveAttribute("aria-disabled", "false");
  expect(chosen).not.toHaveBeenCalled();
  await userEvent.setup().click(row);
  expect(chosen).toHaveBeenCalledExactlyOnceWith(reference);
});
