import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { initialDefinition } from "./editorModel";
import { bindingValue, stringBinding, uuidBinding } from "./runBindings";

const definition = initialDefinition({
  start: "Start",
  read: "Read",
  task: "Task",
  subject: "Follow up",
});
const context = { definition, nodeId: "task", path: ["subject"] };

it.each([false, 0, "", null])("keeps the raw own-key adapter exact for %j", (value) => {
  expect(
    bindingValue(
      { kind: "reference", nodeId: "read", path: ["title"] },
      { read: { title: value } },
    ),
  ).toBe(value);
});

it("uses actual graph type metadata for temporal-to-text without changing the stored string", () => {
  expect(
    stringBinding(
      { kind: "reference", nodeId: "read", path: ["expectedCloseDate"] },
      { read: { expectedCloseDate: "2028-02-29" } },
      context,
    ),
  ).toEqual({ ok: true, value: "2028-02-29" });
});

it("does not qualify a disconnected source just because an own output with that id exists", () => {
  const disconnected = {
    ...definition,
    edges: definition.edges.filter((edge) => edge.to !== "task"),
  };
  expect(
    stringBinding(
      { kind: "reference", nodeId: "read", path: ["title"] },
      { read: { title: "Visible stored value" } },
      { ...context, definition: disconnected },
    ),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
});

it("does not treat a user identity or a UUID-looking title as a deal identity", () => {
  const id = crypto.randomUUID();
  for (const path of ["ownerId", "title"]) {
    expect(
      uuidBinding(
        { kind: "reference", nodeId: "read", path: [path] },
        { read: { ownerId: id, title: id } },
        { ...context, path: ["dealId"] },
      ),
    ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
  }
});

it("rejects incomplete typed literal intent before scalar adapters can pass its raw text onward", () => {
  expect(stringBinding({ kind: "value", value: "-", literalType: "number" }, {}, context)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
});
