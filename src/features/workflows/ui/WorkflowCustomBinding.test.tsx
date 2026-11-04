// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, assert, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import { initialDefinition } from "../editorModel";
import type { WorkflowNode } from "../schemas";
import { WorkflowCustomBinding } from "./WorkflowCustomBinding";

vi.mock("./useWorkflowConfigurationReferences", () => ({
  useWorkflowConfigurationReferences: () => ({
    status: "ready",
    options: [],
    search: "",
    onSearch: vi.fn(),
    nextCursor: null,
    selected: undefined,
    unavailable: true,
    stale: false,
  }),
}));
afterEach(cleanup);
const def: CustomFieldDef = {
  id: "e96b131c-a58c-4469-84b1-81e249e653bc",
  targetEntity: "activity",
  type: "address",
  name: "Site",
  key: "site",
  options: [],
  isRequired: false,
  isImportant: false,
  showInAddForm: false,
  order: 0,
  archivedAt: null,
};
function fixture(binding: WorkflowNode["config"][string]) {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Follow up",
  });
  const node = definition.nodes.find((node) => node.type === "activity.create");
  assert(node !== undefined);
  node.config.customFields = { [def.id]: binding };
  return { definition, node };
}
it("retains invalid coordinate text in the graph instead of keeping the previous valid number", () => {
  const f = fixture({ kind: "value", value: { country: "DE", lat: 0 } });
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const before = structuredClone(f.definition);
  render(
    <LocaleProvider locale="en">
      <WorkflowCustomBinding {...f} def={def} editable onChange={changed} />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Site: Latitude" }), {
    target: { value: "oops" },
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith({
    ...f.node,
    config: {
      ...f.node.config,
      customFields: { [def.id]: { kind: "value", value: { country: "DE", lat: "oops" } } },
    },
  });
  expect(f.definition).toEqual(before);
});
it("reports a confirmed hidden selected custom reference without exposing its UUID as a label", () => {
  const id = "848408c6-faf7-4234-8de1-c63f1c9107dc";
  const f = fixture({ kind: "value", value: id });
  const changed = vi.fn();
  render(
    <LocaleProvider locale="en">
      <WorkflowCustomBinding
        {...f}
        def={{ ...def, type: "person" }}
        workflowId="52f6b244-2ea8-400a-92c9-b584c938562f"
        fingerprint={"a".repeat(64)}
        editable
        onChange={changed}
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/unavailable|available/i);
  expect(screen.queryByText(id)).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});
it("associates a retained unavailable mapping with its field error description", () => {
  const f = fixture({ kind: "reference", nodeId: "start", path: ["missing"] });
  const changed = vi.fn();
  render(
    <LocaleProvider locale="en">
      <WorkflowCustomBinding {...f} def={{ ...def, type: "text" }} editable onChange={changed} />
    </LocaleProvider>,
  );
  const group = screen.getByRole("group", { name: def.name });
  expect(group).toHaveAttribute("aria-invalid", "true");
  const id = group.getAttribute("aria-describedby");
  assert(id !== null);
  expect(document.getElementById(id)?.textContent).toMatch(/available/i);
  expect(changed).not.toHaveBeenCalled();
});
