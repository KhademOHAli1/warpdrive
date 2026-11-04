// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { buildCustomFieldsSchema } from "@/features/custom-fields/validate";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import { initialDefinition } from "../editorModel";
import copy from "../messages/workflows.en.json";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { NodeInspector } from "./NodeInspector";

const metadata = vi.hoisted(() => ({
  defs: [] as CustomFieldDef[],
  calls: vi.fn<(input: { target: string }) => void>(),
  refetch: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: () => ({
    metadata: { status: "complete", defs: metadata.defs },
    authoring: true,
    busy: false,
    loadMore: undefined,
    retry: metadata.refetch,
  }),
}));

const effort: CustomFieldDef = {
  id: "848408c6-faf7-4234-8de1-c63f1c9107dc",
  targetEntity: "activity",
  type: "numeric",
  name: "Effort estimate",
  key: "effort_estimate",
  options: [],
  isRequired: true,
  isImportant: false,
  showInAddForm: false,
  order: 0,
  archivedAt: null,
};
const followUp: CustomFieldDef = {
  id: "e96b131c-a58c-4469-84b1-81e249e653bc",
  targetEntity: "activity",
  type: "text",
  name: "Follow-up code",
  key: "follow_up_code",
  options: [],
  isRequired: false,
  isImportant: true,
  showInAddForm: false,
  order: 1,
  archivedAt: null,
};

beforeEach(() => {
  metadata.defs = [structuredClone(effort), structuredClone(followUp)];
  metadata.calls.mockClear();
  metadata.refetch.mockReset();
  metadata.refetch.mockResolvedValue(undefined);
});
afterEach(cleanup);

function taskFixture(config: WorkflowNode["config"] = {}) {
  const definition = initialDefinition({
    start: "Manual start",
    read: "Read deal",
    task: "Create task",
    subject: "Follow up",
  });
  const original = definition.nodes.find((node) => node.type === "activity.create");
  assert(original !== undefined);
  const node: WorkflowNode = { ...original, config: { ...original.config, ...config } };
  return {
    definition: {
      ...definition,
      nodes: definition.nodes.map((item) => (item.id === node.id ? node : item)),
    },
    node,
  };
}

function inspector(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  onChange: (node: WorkflowNode) => void,
  editable = true,
  onRemove = vi.fn(),
) {
  return (
    <LocaleProvider locale="en">
      <NodeInspector
        workflowId="52f6b244-2ea8-400a-92c9-b584c938562f"
        definition={definition}
        node={node}
        editable={editable}
        onChange={onChange}
        onRemove={onRemove}
      />
    </LocaleProvider>
  );
}

function expectAssociatedError(control: HTMLElement, message: RegExp) {
  expect(control).toHaveAttribute("aria-invalid", "true");
  const ids = [control.getAttribute("aria-describedby"), control.getAttribute("aria-errormessage")]
    .filter((value) => value !== null)
    .join(" ")
    .split(/\s+/u)
    .filter(Boolean);
  expect(ids.length).toBeGreaterThan(0);
  const elements = ids.map((id) => document.getElementById(id));
  for (const element of elements) expect(element).not.toBeNull();
  const text = elements.map((element) => element?.textContent ?? "").join(" ");
  expect(text).toMatch(message);
  expect(text).not.toMatch(/Zod|invalid_type|config\.subject|\{"kind"/u);
}

it("keeps existing task name and title callbacks while preserving the stored graph", () => {
  const { definition, node } = taskFixture();
  const before = structuredClone(definition);
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(inspector(definition, node, onChange));

  fireEvent.change(screen.getByRole("textbox", { name: copy.stepName }), {
    target: { value: "Review renewal" },
  });
  expect(onChange).toHaveBeenNthCalledWith(1, {
    ...node,
    name: "Review renewal",
    nameMode: "custom",
  });
  fireEvent.change(screen.getByRole("textbox", { name: copy.subjectLabel }), {
    target: { value: "Call after the review" },
  });
  expect(onChange).toHaveBeenNthCalledWith(2, {
    ...node,
    config: { ...node.config, subject: { kind: "value", value: "Call after the review" } },
  });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(definition).toEqual(before);
  expect(screen.queryByText(/JSON/u)).not.toBeInTheDocument();
});

it("retains a readonly task definition without allowing edits or removal", async () => {
  const { definition, node } = taskFixture();
  const before = structuredClone(definition);
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  const onRemove = vi.fn();
  render(inspector(definition, node, onChange, false, onRemove));
  const name = screen.getByRole("textbox", { name: copy.stepName });
  const title = screen.getByRole("textbox", { name: copy.subjectLabel });
  expect(name).toBeDisabled();
  expect(title).toBeDisabled();
  expect(screen.getByRole("combobox", { name: copy.linkedDeal })).toBeDisabled();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  const user = userEvent.setup();
  await user.type(name, "Unexpected name");
  await user.type(title, "Unexpected title");
  expect(screen.queryByRole("button", { name: copy.remove })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  expect(onRemove).not.toHaveBeenCalled();
  expect(definition).toEqual(before);
});

it("uses valid canonical activity definitions with numeric zero, omission and nonnullable custom values", () => {
  const defs = [structuredClone(effort), structuredClone(followUp)];
  const before = structuredClone(defs);
  const schema = buildCustomFieldsSchema(defs);
  expect(schema.parse({ effort_estimate: 0 })).toEqual({ effort_estimate: 0 });
  expect(schema.parse({ effort_estimate: 0, follow_up_code: "RENEWAL" })).toEqual({
    effort_estimate: 0,
    follow_up_code: "RENEWAL",
  });
  expect(schema.safeParse({}).success).toBe(false);
  expect(schema.safeParse({ effort_estimate: "0" }).success).toBe(false);
  expect(schema.safeParse({ effort_estimate: 0, follow_up_code: null }).success).toBe(false);
  expect(defs).toEqual(before);
});

it("associates safe required and type errors with the current invalid task title", () => {
  const empty = taskFixture({ subject: { kind: "value", value: "" } });
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  const mounted = render(inspector(empty.definition, empty.node, onChange));
  expectAssociatedError(screen.getByRole("textbox", { name: copy.subjectLabel }), /required/i);
  expect(empty.node.config.subject).toEqual({ kind: "value", value: "" });

  const numeric = taskFixture({ subject: { kind: "value", value: 42 } });
  mounted.rerender(inspector(numeric.definition, numeric.node, onChange));
  expectAssociatedError(screen.getByRole("textbox", { name: copy.subjectLabel }), /text|string/i);
  expect(numeric.node.config.subject).toEqual({ kind: "value", value: 42 });
  expect(onChange).not.toHaveBeenCalled();
});

it("shows an explicit No linked deal state for stored null and retains null on another field edit", () => {
  const { definition, node } = taskFixture({ dealId: { kind: "value", value: null } });
  const before = structuredClone(definition);
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(inspector(definition, node, onChange));
  expect(screen.getByRole("combobox", { name: copy.linkedDeal })).toHaveTextContent(
    "No linked deal",
  );
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: copy.subjectLabel }), {
    target: { value: "Unlinked follow up" },
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    ...node,
    config: { ...node.config, subject: { kind: "value", value: "Unlinked follow up" } },
  });
  expect(node.config.dealId).toEqual({ kind: "value", value: null });
  expect(definition).toEqual(before);
});

it("renders an active activity custom field supplied through the existing metadata query API", () => {
  const { definition, node } = taskFixture();
  const before = structuredClone(definition);
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(inspector(definition, node, onChange));
  expect(screen.getByRole("textbox", { name: followUp.name })).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
  expect(definition).toEqual(before);
});
