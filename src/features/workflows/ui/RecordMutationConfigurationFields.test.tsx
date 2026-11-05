// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { messagesForLocale } from "@/features/i18n/catalog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { RecordMutationConfigurationFields } from "./RecordMutationConfigurationFields";

const referenceHook = vi.hoisted(() => vi.fn());
const selectedQuery = vi.hoisted(() => vi.fn());
vi.mock("./useWorkflowConfigurationReferences", () => ({
  useWorkflowConfigurationReferences: referenceHook,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: { workflows: { configurationReferences: { useQuery: selectedQuery } } },
}));
const workflowId = "52f6b244-2ea8-400a-92c9-b584c9385632";
const recordId = "52f6b244-2ea8-400a-92c9-b584c938562f";
afterEach(cleanup);

function Harness({
  type,
  initial = {},
  editable = true,
  onChange,
}: {
  type: "record.update" | "record.delete";
  initial?: WorkflowNode["config"];
  editable?: boolean;
  onChange: (node: WorkflowNode) => void;
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "change",
    type,
    version: 1,
    name: "Change record",
    config: initial,
  });
  return (
    <LocaleProvider locale="en">
      <RecordMutationConfigurationFields
        definition={{ schemaVersion: 1, nodes: [node], edges: [] }}
        node={node}
        editable={editable}
        workflowId={workflowId}
        validation={{ status: "valid", issues: [], runtimeChecks: [] }}
        onChange={(next) => {
          setNode(next);
          onChange(next);
        }}
      />
    </LocaleProvider>
  );
}

function lookup(label: string) {
  referenceHook.mockReturnValue({
    status: "ready",
    options: [{ id: recordId, label }],
    search: "",
    nextCursor: null,
    unavailable: false,
    stale: false,
    onSearch: vi.fn(),
    retry: vi.fn(),
  });
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label, exact: true }));
  await user.click(screen.getByRole("option", { name: option, exact: true }));
}

it("opens the scoped named Record chooser after Object and edits only selected fields", async () => {
  lookup("Northwind");
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness type="record.update" onChange={onChange} />);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  await choose(user, "Object", "Organizations");
  expect(referenceHook).toHaveBeenLastCalledWith(
    expect.objectContaining({
      workflowId,
      type: "record.update",
      selector: { kind: "record", entity: "organization" },
    }),
  );
  await choose(user, "Record · Select a record", "Northwind");
  await choose(user, "Add a field", "Name");
  await user.type(screen.getByRole("textbox", { name: "Name", exact: true }), "Northwind Labs");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: {
        entity: "organization",
        recordId: { kind: "value", value: recordId },
        fields: { name: { kind: "value", value: "Northwind Labs" } },
      },
    }),
  );
  await user.click(screen.getByRole("button", { name: "Remove Name" }));
  expect(screen.queryByRole("textbox", { name: "Name", exact: true })).toBeNull();
  await choose(user, "Object", "People");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { entity: "person", fields: {} },
    }),
  );
});

it("shows the selected record by name and has no update fields for soft deletion", () => {
  lookup("Intro follow-up");
  render(
    <Harness
      type="record.delete"
      initial={{
        entity: "activity",
        recordId: { kind: "value", value: recordId },
      }}
      onChange={vi.fn()}
    />,
  );
  expect(referenceHook).toHaveBeenLastCalledWith(
    expect.objectContaining({
      selectedId: recordId,
      selector: { kind: "record", entity: "activity" },
    }),
  );
  expect(screen.getByRole("combobox", { name: "Record · Select a record" })).toHaveTextContent(
    "Intro follow-up",
  );
  expect(screen.queryByRole("combobox", { name: "Add a field" })).toBeNull();
  expect(
    screen.getByText(messagesForLocale("en").workflows.recordMutationSoftDeleteHint),
  ).toBeVisible();
});

it("reads only a saved label in readonly mode and hides it after access is lost", () => {
  const data = {
    state: "page",
    mode: "selected",
    type: "record.delete",
    version: 1,
    workflowId,
    field: { kind: "record", entity: "organization" },
    items: [{ id: recordId, label: "Northwind" }],
  };
  selectedQuery.mockReturnValue({ data, isError: false });
  const component = (
    <Harness
      type="record.delete"
      editable={false}
      initial={{
        entity: "organization",
        recordId: { kind: "value", value: recordId },
      }}
      onChange={vi.fn()}
    />
  );
  const view = render(component);
  expect(selectedQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: "selected", ids: [recordId] }),
    expect.objectContaining({ enabled: true }),
  );
  expect(screen.getByRole("combobox", { name: "Record", exact: true })).toHaveTextContent(
    "Northwind",
  );
  expect(screen.queryByRole("textbox", { name: /search choices/i })).toBeNull();

  selectedQuery.mockReturnValue({ data, isError: true });
  view.rerender(<Harness {...component.props} />);
  expect(screen.queryByText("Northwind")).toBeNull();
});
