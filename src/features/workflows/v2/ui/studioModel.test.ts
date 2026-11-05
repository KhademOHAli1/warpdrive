import { describe, expect, it } from "vitest";
import {
  ACTION_BLOCK_KINDS,
  type WorkflowV2Definition,
  type WorkflowV2Node,
} from "@/features/blocks/contracts";
import { validateWorkflowV2 } from "@/features/blocks/validation";
import {
  arrangeStudio,
  asArray,
  asObject,
  connectStudioNodes,
  initialConfig,
  studioVariables,
  updateStudioNode,
  textValue,
} from "./studioModel";

function node(id: string, type: WorkflowV2Node["type"]): WorkflowV2Node {
  return { id, type, version: 1, name: id, config: initialConfig(type) };
}
const labels = { wholeRecord: "Whole record", wholeList: "Whole list", output: "Output" };
describe("workflow studio graph authoring", () => {
  it("gives all 21 action kinds structured, isolated draft configurations", () => {
    expect(ACTION_BLOCK_KINDS).toHaveLength(21);
    for (const type of ACTION_BLOCK_KINDS)
      expect(Object.keys(initialConfig(type)).length).toBeGreaterThan(0);
    expect(initialConfig("CODE")).toHaveProperty("sourceCode");
    expect(initialConfig("SEND_EMAIL")).toHaveProperty("accountId");
    expect(initialConfig("FORM")).toHaveProperty("fields");
  });
  it("keeps ordered branch routes and removes only edges from a deleted route", () => {
    const branch = node("branch", "IF_ELSE");
    const route = asObject(asArray(branch.config.branches)[0]);
    const fallback = asObject(asArray(branch.config.branches)[1]);
    const definition: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "manual", config: {} },
      nodes: [branch, node("first", "FILTER"), node("second", "DELAY")],
      edges: [
        { id: "one", source: "branch", target: "first", sourcePort: textValue(route.id) },
        { id: "two", source: "branch", target: "second", sourcePort: textValue(fallback.id) },
      ],
      entryNodeIds: ["branch"],
    };
    const updated = updateStudioNode(definition, { ...branch, config: { branches: [fallback] } });
    expect(updated.edges.map((edge) => edge.id)).toEqual(["two"]);
    expect(updated.nodes).toHaveLength(3);
  });
  it("preserves explicit iterator loop and done ports without graph cycles", () => {
    const base: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "manual", config: {} },
      nodes: [node("iterator", "ITERATOR"), node("work", "FILTER"), node("done", "DELAY")],
      edges: [],
      entryNodeIds: ["iterator"],
    };
    const loop = connectStudioNodes(base, "iterator", "work", "loop");
    if (loop === null) throw new Error("Expected loop connection");
    const graph = connectStudioNodes(loop, "iterator", "done", "done");
    if (graph === null) throw new Error("Expected done connection");
    expect(validateWorkflowV2(graph).ok).toBe(true);
    expect(connectStudioNodes(graph, "work", "iterator", "next")).toBeNull();
    expect(arrangeStudio(graph).layout?.work?.y).toBe(arrangeStudio(graph).layout?.done?.y);
  });
  it("offers only upstream records and arrays with the exact persisted binding path", () => {
    const graph: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "manual", config: {} },
      nodes: [
        node("search", "FIND_RECORDS"),
        node("loop", "ITERATOR"),
        node("other", "CREATE_RECORD"),
      ],
      edges: [{ id: "flow", source: "search", target: "loop", sourcePort: "next" }],
      entryNodeIds: ["search", "other"],
    };
    const { choices, references } = studioVariables(graph, "loop", {}, labels);
    expect(choices.find((choice) => choice.id === "search:records")).toMatchObject({
      type: "array",
      label: "Whole list",
    });
    expect(references.get("search:records")).toEqual({
      kind: "reference",
      nodeId: "search",
      path: ["records"],
    });
    expect(choices.some((choice) => choice.group === "other")).toBe(false);
  });
});
