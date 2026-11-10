// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { ConfigurationValidation } from "../configurationTypes";
import type { WorkflowNode } from "../schemas";
import {
  PickRecordConfigurationFields,
  type RecordPickCandidateRead,
} from "./PickRecordConfigurationFields";
import { SearchRecordConfigurationFields } from "./SearchRecordConfigurationFields";

afterEach(cleanup);
const id = "af198b82-93d9-42b0-a48c-31a21390e161";
const node: WorkflowNode = {
  id: "lookup",
  type: "record.read",
  version: 1,
  name: "Lookup",
  config: {},
};
const validation: ConfigurationValidation = { status: "valid", issues: [], runtimeChecks: [] };

function SearchHarness({ onChange }: { onChange: (node: WorkflowNode) => void }) {
  const [current, setCurrent] = useState(node);
  return (
    <SearchRecordConfigurationFields
      definition={{ schemaVersion: 1, nodes: [current], edges: [] }}
      node={current}
      editable
      validation={validation}
      metadata={{ status: "complete", defs: [] }}
      onChange={(next) => {
        setCurrent(next);
        onChange(next);
      }}
    />
  );
}

function PickHarness({
  initial = {},
  onChange,
  read,
}: {
  initial?: WorkflowNode["config"];
  onChange: (node: WorkflowNode) => void;
  read: RecordPickCandidateRead;
}) {
  const [current, setCurrent] = useState({ ...node, config: initial });
  return (
    <PickRecordConfigurationFields
      node={current}
      editable
      validation={validation}
      read={read}
      onChange={(next) => {
        setCurrent(next);
        onChange(next);
      }}
    />
  );
}

async function select(user: ReturnType<typeof userEvent.setup>, label: string, choice: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: choice }));
}

it("edits search filters and sorting, then clears object-specific settings on object change", async () => {
  const user = userEvent.setup();
  const changed = vi.fn<(node: WorkflowNode) => void>();
  render(
    <LocaleProvider locale="en">
      <SearchHarness onChange={changed} />
    </LocaleProvider>,
  );
  await select(user, "Object", "Deals");
  expect(screen.getByRole("textbox", { name: "Limit" })).toHaveValue("1");
  fireEvent.change(screen.getByRole("textbox", { name: "Limit" }), { target: { value: "4" } });
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  await select(user, "Operator", "Contains");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "Acme" } });
  await user.click(screen.getByRole("button", { name: "Add sort" }));
  await select(user, "Direction", "Descending");
  expect(changed.mock.lastCall?.[0].config).toMatchObject({
    entity: "deal",
    filter: {
      kind: "group",
      combinator: "and",
      entries: [{ field: "title", operator: "contains", value: { kind: "value", value: "Acme" } }],
    },
    orderBy: [{ field: "title", direction: "desc" }],
    limit: { kind: "value", value: 4 },
  });
  await select(user, "Object", "People");
  expect(changed.mock.lastCall?.[0].config).toEqual({
    entity: "person",
    limit: { kind: "value", value: 4 },
  });
});

it("selects only named candidates and configures the supported related task count", async () => {
  const user = userEvent.setup();
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const read: RecordPickCandidateRead = {
    search: "",
    onSearch: vi.fn(),
    status: "ready",
    options: [{ id, label: "Ada Example" }],
  };
  render(
    <LocaleProvider locale="en">
      <PickHarness onChange={changed} read={read} />
    </LocaleProvider>,
  );
  await select(user, "Object", "People");
  await select(user, "Strategy", "Load balanced");
  await select(user, "Balance by", "Tasks");
  expect(screen.getByRole("combobox", { name: "Count by" })).toHaveTextContent("Person");
  await select(user, "Add record", "Ada Example");
  expect(changed.mock.lastCall?.[0].config).toEqual({
    entity: "person",
    strategy: "LOAD_BALANCED",
    recordIds: [id],
    loadBalance: { entity: "activity", field: "personId" },
  });
  await user.click(screen.getByRole("button", { name: "Remove · Ada Example" }));
  expect(changed.mock.lastCall?.[0].config.recordIds).toEqual([]);
});

it("does not render stale candidate names or a search control after lookup denial", () => {
  const read: RecordPickCandidateRead = {
    search: "",
    onSearch: vi.fn(),
    status: "denied",
    options: [{ id, label: "Stale record name" }],
    selected: [{ id, label: "Stale record name" }],
  };
  render(
    <LocaleProvider locale="en">
      <PickHarness
        initial={{ entity: "person", strategy: "ROUND_ROBIN", recordIds: [id] }}
        read={read}
        onChange={vi.fn()}
      />
    </LocaleProvider>,
  );
  expect(screen.queryByText("Stale record name")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Search records" })).not.toBeInTheDocument();
  expect(screen.getByText(/Record lookup is unavailable/)).toBeVisible();
});
