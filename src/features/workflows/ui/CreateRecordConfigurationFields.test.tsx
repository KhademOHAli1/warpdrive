// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { CreateRecordConfigurationFields } from "./CreateRecordConfigurationFields";

const pipelines = vi.hoisted(() => [
  { id: "first", name: "Enterprise", stages: [{ id: "demo", name: "Demo scheduled" }] },
  { id: "second", name: "Partners", stages: [{ id: "intro", name: "Introduction" }] },
]);
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    pipeline: { list: { useQuery: () => ({ isSuccess: true, isError: false, data: pipelines }) } },
  },
}));
afterEach(cleanup);

function Harness({
  initial,
  onChange,
}: {
  initial: WorkflowNode["config"];
  onChange: (node: WorkflowNode) => void;
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "create",
    name: "Create record",
    type: "record.create",
    version: 1,
    config: initial,
  });
  return (
    <LocaleProvider locale="en">
      <CreateRecordConfigurationFields
        definition={{ schemaVersion: 1, nodes: [node], edges: [] }}
        node={node}
        editable
        validation={{ status: "valid", issues: [], runtimeChecks: [] }}
        onChange={(next) => {
          setNode(next);
          onChange(next);
        }}
      />
    </LocaleProvider>
  );
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label, exact: true }));
  await user.click(screen.getByRole("option", { name: option, exact: true }));
}

it("asks for the object first and clears the previous object's fields on change", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial={{ fields: {} }} onChange={onChange} />);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  await choose(user, "Object", "People");
  expect(screen.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Primary email source" })).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Pipeline", exact: true })).toBeNull();
  await user.type(screen.getByRole("textbox", { name: "Name", exact: true }), "Sam");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { entity: "person", fields: { name: { kind: "value", value: "Sam" } } },
    }),
  );
  await choose(user, "Object", "Organizations");
  expect(screen.queryByRole("combobox", { name: "Primary email source" })).toBeNull();
  expect(screen.getByRole("combobox", { name: "City source" })).toBeVisible();
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { entity: "organization", fields: {} },
    }),
  );
});

it("shows named pipeline and stage choices and resets the previous stage when the pipeline changes", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <Harness
      initial={{
        entity: "deal",
        fields: {
          title: { kind: "value", value: "Example" },
          pipelineId: { kind: "value", value: "first" },
          stageId: { kind: "value", value: "demo" },
        },
      }}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Pipeline", exact: true })).toHaveTextContent(
    "Enterprise",
  );
  expect(screen.getByRole("combobox", { name: "Stage", exact: true })).toHaveTextContent(
    "Demo scheduled",
  );
  await choose(user, "Pipeline", "Partners");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: {
        entity: "deal",
        fields: {
          title: { kind: "value", value: "Example" },
          pipelineId: { kind: "value", value: "second" },
        },
      },
    }),
  );
  await choose(user, "Stage", "Introduction");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: {
        entity: "deal",
        fields: {
          title: { kind: "value", value: "Example" },
          pipelineId: { kind: "value", value: "second" },
          stageId: { kind: "value", value: "intro" },
        },
      },
    }),
  );
});
