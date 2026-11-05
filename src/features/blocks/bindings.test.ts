import { expect, it } from "vitest";
import { resolveBlockConfig } from "./bindings";

const outputs = {
  "|find": {
    nodeId: "find",
    framePath: [],
    output: { records: [{ id: "parent" }], title: "Outside" },
  },
  "loop:0|find": {
    nodeId: "find",
    framePath: ["loop:0"],
    output: { records: [{ id: "inside" }], title: "Inside" },
  },
};
it("resolves whole arrays and nearest frame outputs without coercing records", () => {
  expect(
    resolveBlockConfig(
      { items: { kind: "reference", nodeId: "find", path: ["records"] } },
      outputs,
      ["loop:0"],
      {},
    ),
  ).toEqual({ ok: true, value: { items: [{ id: "inside" }] } });
  expect(
    resolveBlockConfig(
      { id: { kind: "reference", nodeId: "find", path: ["records", 0, "id"] } },
      outputs,
      [],
      {},
    ),
  ).toEqual({ ok: true, value: { id: "parent" } });
});
it("uses explicit template variables and keeps literal JSON inert", () => {
  expect(
    resolveBlockConfig(
      {
        subject: {
          kind: "template",
          template: "Hello {{name}}",
          variables: { name: { kind: "reference", nodeId: "$trigger", path: ["name"] } },
        },
        payload: { kind: "literal", value: { kind: "reference", nodeId: "hidden", path: [] } },
      },
      {},
      [],
      { name: "Ali" },
    ),
  ).toEqual({
    ok: true,
    value: { subject: "Hello Ali", payload: { kind: "reference", nodeId: "hidden", path: [] } },
  });
});
it("fails closed for missing and prototype paths instead of widening record references", () => {
  expect(
    resolveBlockConfig(
      { recordId: { kind: "reference", nodeId: "find", path: ["absent"] } },
      outputs,
      [],
      {},
    ).ok,
  ).toBe(false);
  expect(
    resolveBlockConfig(
      { recordId: { kind: "reference", nodeId: "find", path: ["constructor"] } },
      outputs,
      [],
      {},
    ).ok,
  ).toBe(false);
  expect(
    resolveBlockConfig(
      {
        subject: {
          kind: "template",
          template: "{{data}}",
          variables: { data: { kind: "reference", nodeId: "find", path: ["records"] } },
        },
      },
      outputs,
      [],
      {},
    ).ok,
  ).toBe(false);
});
