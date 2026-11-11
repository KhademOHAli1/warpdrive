// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_BLOCK_KINDS,
  type ActionBlockKind,
  type WorkflowV2Definition,
  type WorkflowV2Studio,
} from "@/features/blocks/contracts";
import { initialConfig } from "./studioModel";
import { WorkflowStudioInspector } from "./WorkflowStudioInspector";

vi.mock("../actions", () => ({
  lookupWorkflowV2RecordsAction: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));
vi.mock("@/features/email/composer/RichTextBodyLazy", () => ({ RichTextBody: () => null }));
vi.mock("@/components/ui/Select", () => ({
  Select: ({
    value,
    onChange,
    options,
    ariaLabel,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const recordId = "10000000-0000-4000-8000-000000000001";
const studio: WorkflowV2Studio = {
  objects: [
    {
      name: "deal",
      label: "Deal",
      fields: [
        {
          key: "id",
          label: "ID",
          type: "string",
          readable: true,
          createable: false,
          updateable: false,
          upsertIdentity: true,
        },
        {
          key: "value",
          label: "Value",
          type: "number",
          readable: true,
          createable: true,
          updateable: true,
        },
      ],
    },
    {
      name: "person",
      label: "Person",
      fields: [
        {
          key: "id",
          label: "ID",
          type: "string",
          readable: true,
          createable: false,
          updateable: false,
          upsertIdentity: true,
        },
        {
          key: "primaryEmail",
          label: "Email",
          type: "string",
          readable: true,
          createable: true,
          updateable: true,
          upsertIdentity: true,
        },
      ],
    },
    {
      name: "activity",
      label: "Activity",
      fields: [
        {
          key: "dealId",
          label: "Deal",
          type: "string",
          readable: true,
          createable: true,
          updateable: true,
          referenceObject: "deal",
        },
      ],
    },
  ],
  members: [{ id: recordId, label: "Team member" }],
  accounts: [{ id: recordId, label: "Mailbox", kind: "mail" }],
  models: [{ id: "model-1", label: "Model 1" }],
  functions: [{ id: recordId, label: "Function", inputs: [], outputs: [] }],
  readiness: {},
};
type Case = [ActionBlockKind, string, string, string, string, unknown];
const literal = (value: unknown) => ({ kind: "literal", value });
const cases: Case[] = [
  ["CREATE_RECORD", "combobox", "Object", "person", "objectName", "person"],
  ["UPDATE_RECORD", "textbox", "Record", recordId, "recordId", literal(recordId)],
  ["DELETE_RECORD", "textbox", "Record", recordId, "recordId", literal(recordId)],
  ["UPSERT_RECORD", "combobox", "Field", "id", "matchField", "id"],
  ["FIND_RECORDS", "spinbutton", "Maximum results", "3", "limit", 3],
  ["PICK_RECORD", "combobox", "Distribution", "LOAD_BALANCED", "selectionMode", "LOAD_BALANCED"],
  ["FILTER", "combobox", "Operator", "contains", "condition.conditions.0.operator", "contains"],
  ["IF_ELSE", "textbox", "Route name: 1", "First match", "branches.0.label", "First match"],
  ["ITERATOR", "textbox", "List to iterate", "a,b", "items", literal(["a", "b"])],
  ["DELAY", "textbox", "Seconds", "120", "seconds", literal(120)],
  ["WAIT_FOR_EVENT", "combobox", "Event", "person.updated", "eventName", "person.updated"],
  ["FORM", "textbox", "Label: 1", "Approval note", "fields.0.label", "Approval note"],
  ["NEWSLETTER_CONSENT_STATUS", "textbox", "Newsletter list ID", "7", "listId", literal(7)],
  [
    "NEWSLETTER_INVITE",
    "textbox",
    "Verified newsletter link ID",
    recordId,
    "linkId",
    literal(recordId),
  ],
  ["SEND_EMAIL", "textbox", "To", "team@example.test", "to", literal(["team@example.test"])],
  ["DRAFT_EMAIL", "textbox", "Subject", "Review", "subject", literal("Review")],
  ["CREATE_CALENDAR_EVENT", "textbox", "Title", "Planning", "title", literal("Planning")],
  ["SEND_CHAT_MESSAGE", "combobox", "Recipient", recordId, "recipientId", recordId],
  ["HTTP_REQUEST", "combobox", "Method", "POST", "method", "POST"],
  [
    "CODE",
    "textbox",
    "Source code",
    "export const main = () => ({ result: 2 });",
    "sourceCode",
    "export const main = () => ({ result: 2 });",
  ],
  ["LOGIC_FUNCTION", "combobox", "Function", recordId, "functionId", recordId],
  ["AI_AGENT", "combobox", "Model", "model-1", "providerModel", "model-1"],
  ["CLASSIFY", "textbox", "Data to classify", "A lead", "input", literal("A lead")],
];
afterEach(cleanup);
describe("structured configuration for the shared action catalog", () => {
  it("covers every executable action kind", () => {
    expect(new Set(cases.map(([type]) => type))).toEqual(new Set(ACTION_BLOCK_KINDS));
  });
  it.each(cases)("edits %s through a typed control", (type, role, label, value, path, expected) => {
    const node = {
      id: "step",
      type,
      version: 1 as const,
      name: "Step",
      config: initialConfig(type),
    };
    const definition: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "manual", config: {} },
      nodes: [node],
      edges: [],
      entryNodeIds: [node.id],
    };
    const onChange = vi.fn();
    render(
      <WorkflowStudioInspector
        node={node}
        definition={definition}
        studio={studio}
        disabled={false}
        onChange={onChange}
        onNodeChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const field = screen.getAllByRole(role, { name: label }).at(-1);
    if (field === undefined) throw new Error(`Missing ${label}`);
    fireEvent.change(field, { target: { value } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toHaveProperty(path, expected);
  });

  it("balances candidate deals by visible related activities instead of their value", () => {
    const node = {
      id: "pick",
      type: "PICK_RECORD" as const,
      version: 1 as const,
      name: "Pick a deal",
      config: {
        objectName: "deal",
        recordIds: [{ kind: "literal", value: recordId }],
        selectionMode: "LOAD_BALANCED",
        loadField: "value",
      },
    };
    const onChange = vi.fn();
    render(
      <WorkflowStudioInspector
        node={node}
        definition={{
          schemaVersion: 2,
          trigger: { type: "manual", config: {} },
          nodes: [node],
          edges: [],
          entryNodeIds: [node.id],
        }}
        studio={studio}
        disabled={false}
        onChange={onChange}
        onNodeChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const picker = screen.getByRole("combobox", { name: "Balance by" });
    expect(picker).toHaveDisplayValue("Value");
    const option = screen.getByRole("option", { name: "Activity · Deal" });
    fireEvent.change(picker, { target: { value: option.getAttribute("value") } });
    const updated = onChange.mock.calls[0]?.[0];
    expect(updated).toHaveProperty("loadRelation", { objectName: "activity", field: "dealId" });
    expect(updated).not.toHaveProperty("loadField");
    expect(updated).toHaveProperty("recordIds", node.config.recordIds);
  });
});
