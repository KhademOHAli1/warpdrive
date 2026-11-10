// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { PersonUpsertConfigurationFields } from "./PersonUpsertConfigurationFields";

vi.mock("./WorkflowMutationRecordChoice", () => ({
  WorkflowMutationRecordChoice: () => <span>Authorized organization choices</span>,
}));

const workflowId = "81f1444b-8d8f-4ce1-a769-6c8bf3a030f3";
const organizationId = "abf7229b-c3be-4834-9cf9-2f7036b68b46";
const literal = (value: string | null) => ({ kind: "value" as const, value });
const config = {
  entity: "person",
  key: literal("crm:123"),
  fields: { name: literal("Ada Lovelace"), orgId: literal(organizationId) },
};

afterEach(cleanup);

function Harness({
  editable = true,
  onChange,
}: {
  editable?: boolean;
  onChange: (next: WorkflowNode) => void;
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "upsert",
    type: "record.upsert",
    version: 1,
    name: "Create or Update Record",
    config,
  });
  return (
    <LocaleProvider locale="en">
      <PersonUpsertConfigurationFields
        node={node}
        definition={{ schemaVersion: 1, nodes: [node], edges: [] }}
        editable={editable}
        validation={{ status: "valid", issues: [], runtimeChecks: [] }}
        workflowId={workflowId}
        onChange={(next) => {
          setNode(next);
          onChange(next);
        }}
      />
    </LocaleProvider>
  );
}

it("shows only the stable workflow key and supported Person data", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  expect(screen.getByText("People")).toBeVisible();
  expect(screen.getByText(/The same key in this workflow updates the same person/)).toBeVisible();
  expect(screen.queryByRole("textbox", { name: /person id|email|phone/i })).toBeNull();
  const key = screen.getByRole("textbox", { name: "Stable key" });
  await user.clear(key);
  await user.type(key, "another-key");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ config: { ...config, key: literal("another-key") } }),
  );
});

it("distinguishes explicitly clearing a link from omitting it", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await user.click(screen.getByRole("combobox", { name: "Organization ID source" }));
  await user.click(screen.getByRole("option", { name: "Null (no value)" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { ...config, fields: { ...config.fields, orgId: literal(null) } },
    }),
  );
  await user.click(screen.getByRole("combobox", { name: "Organization ID source" }));
  await user.click(screen.getByRole("option", { name: "Not set" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ config: { ...config, fields: { name: config.fields.name } } }),
  );
});

it("does not let a read-only editor change the stable key or person fields", () => {
  const onChange = vi.fn();
  render(<Harness editable={false} onChange={onChange} />);
  expect(screen.getByRole("textbox", { name: "Stable key" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Organization ID source" })).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
});
