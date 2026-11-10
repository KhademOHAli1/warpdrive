// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type * as DndKit from "@dnd-kit/core";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import {
  workflowHumanFormDraftConfig,
  workflowHumanFormLimits,
} from "../workflowHumanFormContract";
import { HumanFormConfigurationFields } from "./HumanFormConfigurationFields";

const drag = vi.hoisted((): { end?: (event: DndKit.DragEndEvent) => void } => ({}));
vi.mock("@dnd-kit/core", async (original) => {
  const real = await original<typeof DndKit>();
  return {
    ...real,
    DndContext: (props: ComponentProps<typeof real.DndContext>) => {
      drag.end = (event) => props.onDragEnd?.(event);
      return <real.DndContext {...props} />;
    },
  };
});

afterEach(cleanup);

const first = {
  id: "65e0a586-701c-470f-9688-715a457ac5bd",
  label: "Summary",
  type: "text",
  required: true,
  placeholder: "Short summary",
} as const;
const second = {
  id: "dc821dbe-f9e3-4e68-a5f2-6c4e37a5f3ae",
  label: "Review day",
  type: "date",
  required: true,
} as const;

function Harness({
  initial = { fields: [] },
  editable = true,
  onChange,
}: {
  initial?: WorkflowNode["config"];
  editable?: boolean;
  onChange: (next: WorkflowNode) => void;
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "form",
    name: "Form",
    type: "human.form",
    version: 1,
    config: initial,
  });
  return (
    <LocaleProvider locale="en">
      <HumanFormConfigurationFields
        node={node}
        editable={editable}
        validation={{ status: "valid", issues: [], runtimeChecks: [] }}
        onChange={(next) => {
          setNode(next);
          onChange(next);
        }}
      />
    </LocaleProvider>
  );
}

it("adds a field and lets the editor name it without changing its output identity", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(<Harness onChange={onChange} />);
  expect(screen.getByText("Add inputs to your form")).toBeVisible();
  await user.type(screen.getByRole("textbox", { name: "Instructions" }), "Review the record.");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  const added = workflowHumanFormDraftConfig.parse(onChange.mock.lastCall?.[0].config).fields[0];
  expect(added).toMatchObject({ type: "text", label: "Text", required: true });
  const label = screen.getByRole("textbox", { name: "Label" });
  expect(label).toHaveFocus();
  await user.clear(label);
  await user.type(label, "Review note");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { instructions: "Review the record.", fields: [{ ...added, label: "Review note" }] },
    }),
  );
  await user.click(
    within(screen.getByRole("region", { name: "Input settings" })).getByRole("button", {
      name: "Close",
    }),
  );
  expect(screen.getByRole("button", { name: "Input settings: Review note" })).toHaveFocus();
});

it("offers only supported types and clears an inapplicable placeholder when the field becomes a date", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial={{ fields: [first] }} onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: "Input settings: Summary" }));
  await user.click(screen.getByRole("combobox", { name: "Type" }));
  expect(screen.getAllByRole("option").map((item) => item.textContent)).toEqual([
    "Text",
    "Number",
    "Date",
  ]);
  await user.click(screen.getByRole("option", { name: "Date" }));
  expect(screen.queryByRole("textbox", { name: "Placeholder" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "Required" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { fields: [{ id: first.id, type: "date", label: first.label, required: false }] },
    }),
  );
});

it("reorders by field ID and retains the active settings and answer identities", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial={{ fields: [first, second] }} onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: "Input settings: Summary" }));
  expect(screen.getByRole("button", { name: "Reorder field: Summary" })).toBeEnabled();
  act(() =>
    drag.end?.({ active: { id: first.id }, over: { id: second.id } } as DndKit.DragEndEvent),
  );
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ config: { fields: [second, first] } }),
  );
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Summary");
  await user.click(screen.getByRole("button", { name: "Delete field: Review day" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ config: { fields: [first] } }),
  );
});

it("keeps the instructions and field previews readable in a read-only inspector", () => {
  const onChange = vi.fn();
  render(
    <Harness
      initial={{ instructions: "Check the notes.", fields: [first, second] }}
      editable={false}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("textbox", { name: "Instructions" })).toHaveValue("Check the notes.");
  expect(screen.getByRole("textbox", { name: "Instructions" })).toBeDisabled();
  expect(screen.getByText("Short summary")).toBeVisible();
  expect(screen.getByText("Choose a date")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /add field|delete field|reorder field|input settings/i }),
  ).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it("disables adding a ninth field", () => {
  const fields = Array.from({ length: workflowHumanFormLimits.fields }, (_, index) => ({
    ...first,
    id: crypto.randomUUID(),
    label: `Question ${index + 1}`,
  }));
  render(<Harness initial={{ fields }} onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Add field" })).toBeDisabled();
});
