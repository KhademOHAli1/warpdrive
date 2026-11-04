// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { NumberingSystem } from "@/lib/numberingSystem";
import type { CustomFieldDef } from "@/types/customFields";
import { initialDefinition } from "../editorModel";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowNode } from "../schemas";
import { NodeInspector } from "./NodeInspector";
import type { WorkflowConfigurationRead } from "./useWorkflowConfiguration";

const state = vi.hoisted(() => ({ read: null as WorkflowConfigurationRead | null }));
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: () => state.read,
}));
afterEach(cleanup);
const field: CustomFieldDef = {
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
const families = [
  { locale: "en", numberingSystem: "latn", copy: english },
  { locale: "de", numberingSystem: "latn", copy: german },
  { locale: "fa", numberingSystem: "arabext", copy: persian },
  { locale: "fa", numberingSystem: "latn", copy: persian },
] as const;
function ready(): WorkflowConfigurationRead {
  return {
    metadata: { status: "complete", defs: [field], fingerprint: "current" },
    authoring: true,
    busy: false,
    loadMore: undefined,
    retry: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}
beforeEach(() => {
  state.read = ready();
});
function fixture(config: WorkflowNode["config"] = {}) {
  const definition = initialDefinition({
    start: "Start",
    read: "Read deal",
    task: "Create task",
    subject: "Follow up",
  });
  const node = definition.nodes.find((item) => item.type === "activity.create");
  assert(node !== undefined);
  node.config = { ...node.config, ...config };
  return { definition, node };
}
function mount(
  f = fixture(),
  family: { locale: "en" | "de" | "fa"; numberingSystem: NumberingSystem } = families[0],
  editable = true,
) {
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const removed = vi.fn();
  const view = render(
    <LocaleProvider locale={family.locale} numberingSystem={family.numberingSystem}>
      <NodeInspector
        workflowId="52f6b244-2ea8-400a-92c9-b584c938562f"
        definition={f.definition}
        node={f.node}
        editable={editable}
        onChange={changed}
        onRemove={removed}
      />
    </LocaleProvider>,
  );
  return { ...view, changed, removed };
}
it.each(families)(
  "renders an omitted optional-important control in $locale/$numberingSystem without writing",
  (family) => {
    const f = fixture();
    const before = structuredClone(f.definition);
    const { changed } = mount(f, family);
    expect(screen.getByRole("textbox", { name: field.name })).toBeVisible();
    expect(changed).not.toHaveBeenCalled();
    expect(f.definition).toEqual(before);
  },
);
it.each(families)("retains explicit linked-deal null in $locale/$numberingSystem", (family) => {
  const f = fixture({ dealId: { kind: "value", value: null } });
  const { changed } = mount(f, family);
  expect(screen.getByRole("combobox", { name: family.copy.linkedDeal })).toHaveTextContent(
    family.copy.configurationNoLinkedDeal,
  );
  fireEvent.change(screen.getByRole("textbox", { name: family.copy.subjectLabel }), {
    target: { value: "Later call" },
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith({
    ...f.node,
    config: { ...f.node.config, subject: { kind: "value", value: "Later call" } },
  });
  expect(f.node.config.dealId).toEqual({ kind: "value", value: null });
});
it.each(families)("links localized required errors in $locale/$numberingSystem", (family) => {
  const { changed } = mount(fixture({ subject: { kind: "value", value: "" } }), family);
  const control = screen.getByRole("textbox", { name: family.copy.subjectLabel });
  expect(control).toHaveAttribute("aria-invalid", "true");
  const id = control.getAttribute("aria-describedby");
  assert(id !== null);
  expect(document.getElementById(id)?.textContent).toContain(family.copy.configurationRequired);
  expect(changed).not.toHaveBeenCalled();
});
it("keeps required numeric zero typed and optional-important untouched", () => {
  const numeric = { ...field, type: "numeric" as const, isRequired: true };
  state.read = { ...ready(), metadata: { status: "complete", defs: [numeric] } };
  const f = fixture({ customFields: { [field.id]: { kind: "value", value: 0 } } });
  const { changed } = mount(f);
  expect(screen.getByRole("textbox", { name: field.name })).toHaveValue("0");
  expect(changed).not.toHaveBeenCalled();
});
it("changes one custom literal by UUID without mutating another setting", () => {
  const f = fixture({
    customFields: { [field.id]: { kind: "value", value: "OLD" } },
    dealId: { kind: "value", value: null },
  });
  const before = structuredClone(f.definition);
  const { changed } = mount(f);
  fireEvent.change(screen.getByRole("textbox", { name: field.name }), { target: { value: "NEW" } });
  expect(changed).toHaveBeenCalledExactlyOnceWith({
    ...f.node,
    config: { ...f.node.config, customFields: { [field.id]: { kind: "value", value: "NEW" } } },
  });
  expect(f.definition).toEqual(before);
});
it("disables custom edits and removal when current metadata denies authoring", () => {
  state.read = { ...ready(), metadata: { status: "denied" }, authoring: false };
  const { changed, removed } = mount();
  expect(screen.queryByRole("textbox", { name: field.name })).not.toBeInTheDocument();
  expect(screen.getByText(english.configurationMetadataDenied)).toBeVisible();
  expect(screen.getByRole("textbox", { name: english.subjectLabel })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
  expect(removed).not.toHaveBeenCalled();
});
it("does not call a partial schema valid or drop its unknown saved UUID", () => {
  const loadMore = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  state.read = { ...ready(), metadata: { status: "incomplete", defs: [field] }, loadMore };
  const f = fixture({
    customFields: { "848408c6-faf7-4234-8de1-c63f1c9107dc": { kind: "value", value: 0 } },
  });
  const before = structuredClone(f.definition);
  const { changed } = mount(f);
  expect(screen.getByText(english.configurationMetadataIncomplete)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: english.configurationLoadMore }));
  expect(loadMore).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  expect(f.definition).toEqual(before);
});
it("retains dirty literals on stale metadata and offers explicit reload", () => {
  state.read = { ...ready(), metadata: { status: "stale", defs: [field] } };
  const f = fixture({ customFields: { [field.id]: { kind: "value", value: "DIRTY" } } });
  const { changed } = mount(f);
  expect(screen.getByRole("textbox", { name: field.name })).toHaveValue("DIRTY");
  expect(screen.getByText(english.configurationMetadataStale)).toBeVisible();
  expect(screen.getByRole("button", { name: english.retry })).toBeEnabled();
  expect(changed).not.toHaveBeenCalled();
});
it("retains current-key values on read failure and retries without configuration writes", () => {
  const retry = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  state.read = { ...ready(), metadata: { status: "error", defs: [field] }, retry };
  const { changed } = mount();
  expect(screen.getByText(english.configurationMetadataError)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: english.retry }));
  expect(retry).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
});
it("keeps readonly stored custom null visible and invalid without coercion", () => {
  const f = fixture({ customFields: { [field.id]: { kind: "value", value: null } } });
  const before = structuredClone(f.definition);
  const { changed } = mount(f, families[0], false);
  expect(screen.getByText(english.customValueNull)).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
  expect(f.definition).toEqual(before);
});
it("retains unsupported saved task settings and reports the shared unready reason", () => {
  const f = fixture({
    assigneeId: { kind: "value", value: "848408c6-faf7-4234-8de1-c63f1c9107dc" },
  });
  const before = structuredClone(f.definition);
  const { changed } = mount(f);
  expect(screen.getAllByText(english.configurationUnsupportedSetting).length).toBeGreaterThan(0);
  expect(changed).not.toHaveBeenCalled();
  expect(f.definition).toEqual(before);
});
