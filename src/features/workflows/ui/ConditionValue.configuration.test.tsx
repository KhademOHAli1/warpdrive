// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import copy from "../messages/workflows.en.json";
import type { Binding, WorkflowNode } from "../schemas";
import { ConditionValue } from "./ConditionValue";

afterEach(cleanup);
function view(right: WorkflowNode["config"][string], editable = true) {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Follow up",
  });
  const node: WorkflowNode = {
    id: "gate",
    type: "condition",
    version: 1,
    name: "Compare",
    config: {
      left: { kind: "reference", nodeId: "read", path: ["title"] },
      operator: "equals",
      right,
    },
  };
  definition.nodes.push(node);
  definition.edges.push({ from: "task", to: "gate", port: "next" });
  const before = structuredClone(definition);
  const changed = vi.fn<(value: Binding) => void>();
  render(
    <LocaleProvider locale="en">
      <ConditionValue
        definition={definition}
        node={node}
        editable={editable}
        boolean={false}
        status={false}
        onChange={changed}
      />
    </LocaleProvider>,
  );
  return { changed, definition, before };
}
it("shows stored null explicitly without changing it to an empty string", () => {
  const { changed, definition, before } = view({ kind: "value", value: null });
  expect(
    screen.getByRole("combobox", {
      name: copy.conditionValue + " · " + copy.configurationValueMode,
    }),
  ).toHaveTextContent(copy.configurationNullValue);
  expect(screen.queryByRole("textbox", { name: copy.conditionValue })).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  expect(definition).toEqual(before);
});
it("authors explicit null as a real typed edit", async () => {
  const { changed, definition, before } = view({ kind: "value", value: "" });
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("combobox", {
      name: copy.conditionValue + " · " + copy.configurationValueMode,
    }),
  );
  await user.click(screen.getByRole("option", { name: copy.configurationNullValue }));
  expect(changed).toHaveBeenCalledExactlyOnceWith({ kind: "value", value: null });
  expect(definition).toEqual(before);
});
it("authors an actual connected reference instead of a fabricated literal", async () => {
  const { changed, definition, before } = view({ kind: "value", value: "" });
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("combobox", {
      name: copy.conditionValue + " · " + copy.configurationValueMode,
    }),
  );
  await user.click(screen.getByRole("option", { name: new RegExp(copy.fields.title + " · ") }));
  expect(changed).toHaveBeenCalledExactlyOnceWith({
    kind: "reference",
    nodeId: "read",
    path: ["title"],
  });
  expect(definition).toEqual(before);
});
it("keeps readonly null and its mode immutable", async () => {
  const { changed, definition, before } = view({ kind: "value", value: null }, false);
  const mode = screen.getByRole("combobox", {
    name: copy.conditionValue + " · " + copy.configurationValueMode,
  });
  expect(mode).toBeDisabled();
  await userEvent.setup().click(mode);
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  expect(definition).toEqual(before);
});
