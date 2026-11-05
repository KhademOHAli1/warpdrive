// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { workflowHttpRequestConfig } from "../workflowHttpRequestContract";
import { HttpRequestConfigurationFields } from "./HttpRequestConfigurationFields";

const url = { kind: "value", value: "https://api.example.test/orders?from=workflow" } as const;
const defaults = { method: "GET", url };
afterEach(cleanup);

function Harness({
  onChange,
  editable = true,
  config = defaults,
}: {
  onChange: (node: WorkflowNode) => void;
  editable?: boolean;
  config?: WorkflowNode["config"];
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "http",
    type: "http.request",
    version: 1,
    name: "HTTP Request",
    config,
  });
  return (
    <LocaleProvider locale="en">
      <HttpRequestConfigurationFields
        definition={{ schemaVersion: 1, nodes: [node], edges: [] }}
        node={node}
        editable={editable}
        validation={{ status: "valid", issues: [], runtimeChecks: [] }}
        onChange={(updated) => {
          setNode(updated);
          onChange(updated);
        }}
      />
    </LocaleProvider>
  );
}

it("explains operator grants and lets authors enter only application header values", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(<Harness onChange={onChange} />);
  expect(screen.getByText(/operator-approved HTTPS URL/)).toBeVisible();
  expect(screen.getByText(/sent only in live runs/)).toBeVisible();
  expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue(url.value);
  await user.click(screen.getByRole("button", { name: "Add header" }));
  const name = screen.getByRole("textbox", { name: "Header name 1" });
  await user.type(name, "Authorization");
  expect(screen.getByText(/Credentials and routing headers/)).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Header value 1" })).toBeNull();
  await user.clear(name);
  await user.type(name, "x-correlation");
  await user.type(screen.getByRole("textbox", { name: "Header value 1" }), "synthetic");
  expect(workflowHttpRequestConfig.safeParse(onChange.mock.lastCall?.[0].config)).toMatchObject({
    success: true,
    data: { headers: [{ name: "x-correlation", value: { kind: "value", value: "synthetic" } }] },
  });
});

it("authors a text body and clears it when switching to GET", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(<Harness onChange={onChange} />);
  expect(screen.queryByRole("combobox", { name: "Body format" })).toBeNull();
  const method = screen.getByRole("combobox", { name: "HTTP method" });
  await user.click(method);
  await user.click(screen.getByRole("option", { name: "POST" }));
  await user.click(screen.getByRole("combobox", { name: "Body format" }));
  await user.click(screen.getByRole("option", { name: "Text" }));
  await user.type(screen.getByRole("textbox", { name: "Request body" }), "first{Enter}second");
  expect(onChange.mock.lastCall?.[0].config).toEqual({
    url,
    method: "POST",
    body: { kind: "text", value: { kind: "value", value: "first\nsecond" } },
  });
  await user.click(method);
  await user.click(screen.getByRole("option", { name: "GET" }));
  expect(onChange.mock.lastCall?.[0].config).toEqual(defaults);
  expect(screen.queryByRole("textbox", { name: "Request body" })).toBeNull();
});

it("authors a JSON scalar body and declares typed response fields without raw responses", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(<Harness config={{ ...defaults, method: "PATCH" }} onChange={onChange} />);
  await user.click(screen.getByRole("combobox", { name: "Body format" }));
  await user.click(screen.getByRole("option", { name: "JSON object" }));
  await user.click(screen.getByRole("button", { name: "Add JSON field" }));
  await user.type(screen.getByRole("textbox", { name: "Field name 1" }), "amount");
  await user.click(screen.getByRole("combobox", { name: "Field value 1 source" }));
  await user.click(screen.getByRole("option", { name: "Null (no value)" }));
  await user.click(screen.getByRole("button", { name: "Add response field" }));
  await user.type(screen.getByRole("textbox", { name: "Response field 1" }), "count");
  await user.click(screen.getByRole("combobox", { name: "Response type 1" }));
  await user.click(screen.getByRole("option", { name: "Number" }));
  await user.click(screen.getByRole("checkbox", { name: "Allow null Response field 1" }));
  expect(workflowHttpRequestConfig.safeParse(onChange.mock.lastCall?.[0].config)).toMatchObject({
    success: true,
    data: {
      body: { kind: "json", fields: [{ name: "amount", value: { kind: "value", value: null } }] },
      response: [{ name: "count", type: "number", nullable: true }],
    },
  });
  await user.click(screen.getByRole("button", { name: "Remove Response field 1" }));
  expect(onChange.mock.lastCall?.[0].config.response).toEqual([]);
});

it("keeps read-only fields disabled and never renders a stored credential value", () => {
  const onChange = vi.fn();
  render(
    <Harness
      editable={false}
      onChange={onChange}
      config={{
        ...defaults,
        headers: [{ name: "Authorization", value: { kind: "value", value: "hidden-synthetic" } }],
      }}
    />,
  );
  expect(screen.getByRole("textbox", { name: "URL" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "HTTP method" })).toBeDisabled();
  expect(screen.queryByDisplayValue("hidden-synthetic")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add header" })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
