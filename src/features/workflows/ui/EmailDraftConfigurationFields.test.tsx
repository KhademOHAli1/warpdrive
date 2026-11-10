// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { EmailDraftConfigurationFields } from "./EmailDraftConfigurationFields";

const mailbox = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn() }));
vi.mock("@/features/email/composer/useComposerMailboxes", () => ({
  useComposerMailboxes: mailbox.read,
}));

const accountId = "81f1444b-8d8f-4ce1-a769-6c8bf3a030f3";
const pausedId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const current = {
  known: true,
  loading: false,
  error: false,
  retry: mailbox.retry,
  mailboxes: [
    { id: accountId, emailAddress: "agent@example.test", status: "connected" },
    { id: pausedId, emailAddress: "paused@example.test", status: "paused" },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mailbox.read.mockReturnValue(current);
});
afterEach(cleanup);

function Harness({
  initial = {},
  editable = true,
  onChange,
}: {
  initial?: WorkflowNode["config"];
  editable?: boolean;
  onChange: (next: WorkflowNode) => void;
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "draft",
    name: "Draft Email",
    type: "email.draft" as WorkflowNode["type"],
    version: 1,
    config: initial,
  });
  return (
    <LocaleProvider locale="en">
      <EmailDraftConfigurationFields
        definition={{ schemaVersion: 1, nodes: [node], edges: [] }}
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

it("lets the actor choose an owned local-draft mailbox and preserves authored fields", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText(/Preview never saves or sends an email/)).toBeVisible();
  await user.click(screen.getByRole("combobox", { name: "From" }));
  await user.click(screen.getByRole("option", { name: "paused@example.test" }));
  await user.type(screen.getByRole("textbox", { name: "To" }), "editor@example.test");
  await user.type(screen.getByRole("textbox", { name: "Body" }), "First{Enter}Second");
  await user.click(screen.getByText("Advanced options"));
  await user.type(screen.getByRole("textbox", { name: "BCC" }), "reviewer@example.test");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: {
        accountId: pausedId,
        to: { kind: "value", value: "editor@example.test" },
        body: { kind: "value", value: "First\nSecond" },
        bcc: { kind: "value", value: "reviewer@example.test" },
      },
    }),
  );
});

it("shows a saved mailbox that is no longer owned as unavailable and keeps it unchanged", () => {
  const onChange = vi.fn();
  render(<Harness initial={{ accountId: "missing" }} onChange={onChange} />);
  expect(screen.getByRole("combobox", { name: "From" })).toHaveTextContent(/unavailable/i);
  expect(screen.queryByText("missing")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it("blocks selection after a mailbox read error and offers a retry", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  mailbox.read.mockReturnValue({ ...current, error: true });
  render(<Harness onChange={onChange} />);
  expect(screen.getByRole("combobox", { name: "From" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Your mailboxes could not be loaded");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(mailbox.retry).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps the sender and draft content read-only in a version inspector", () => {
  const onChange = vi.fn();
  render(
    <Harness
      editable={false}
      initial={{ accountId, body: { kind: "value", value: "Preview body" } }}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("combobox", { name: "From" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveValue("Preview body");
  expect(screen.getByRole("textbox", { name: "Body" })).toBeDisabled();
  expect(screen.queryByText("Advanced options")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
