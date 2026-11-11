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
  duplicateStudioNode,
  initialConfig,
  insertStudioNodeOnEdge,
  replaceStudioNode,
  studioVariables,
  textValue,
  updateStudioNode,
} from "./studioModel";

function node(id: string, type: WorkflowV2Node["type"]): WorkflowV2Node {
  return { id, type, version: 1, name: id, config: initialConfig(type) };
}
const labels = { wholeRecord: "Whole record", wholeList: "Whole list", output: "Output" };
describe("workflow studio graph authoring", () => {
  it("gives every action kind a structured draft configuration", () => {
    for (const type of ACTION_BLOCK_KINDS)
      expect(Object.keys(initialConfig(type)).length).toBeGreaterThan(0);
    expect(initialConfig("CODE")).toHaveProperty("sourceCode");
    expect(initialConfig("SEND_EMAIL")).toHaveProperty("accountId");
    expect(initialConfig("FORM")).toHaveProperty("fields");
    expect(initialConfig("NEWSLETTER_CONSENT_STATUS")).toEqual({ personId: "", listId: "" });
    expect(initialConfig("NEWSLETTER_INVITE")).toEqual({ personId: "", listId: "", linkId: "" });
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
  it("inserts on a specific connection without stealing the sibling branch or iterator loop", () => {
    const graph: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "manual", config: {} },
      nodes: [node("loop", "ITERATOR"), node("process", "CODE"), node("finish", "DELAY")],
      edges: [
        { id: "branch", source: "loop", target: "process", sourcePort: "loop" },
        { id: "complete", source: "loop", target: "finish", sourcePort: "done" },
      ],
      entryNodeIds: ["loop"],
    };
    const prepare = node("prepare", "CODE");
    const inserted = insertStudioNodeOnEdge(graph, prepare, "branch");
    expect(inserted?.edges).toEqual([
      { id: "branch", source: "loop", target: "prepare", sourcePort: "loop" },
      { id: "complete", source: "loop", target: "finish", sourcePort: "done" },
      expect.objectContaining({ source: "prepare", target: "process", sourcePort: "next" }),
    ]);
    expect(inserted !== null && validateWorkflowV2(inserted).ok).toBe(true);
    expect(insertStudioNodeOnEdge(graph, prepare, "stale")).toBeNull();
    expect(insertStudioNodeOnEdge(graph, prepare, "$trigger:loop")).toMatchObject({
      entryNodeIds: ["prepare"],
      edges: expect.arrayContaining([
        expect.objectContaining({ source: "prepare", target: "loop", sourcePort: "next" }),
      ]),
    });
  });
  it("replaces the action in place and maps only iterator continuation edges", () => {
    const graph: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "manual", config: {} },
      nodes: [node("iterator", "ITERATOR"), node("body", "CODE"), node("done", "DELAY")],
      edges: [
        { id: "branch", source: "iterator", target: "body", sourcePort: "loop" },
        { id: "continuation", source: "iterator", target: "done", sourcePort: "done" },
      ],
      entryNodeIds: ["iterator"],
      layout: { iterator: { x: 140, y: 320 } },
    };
    const replacement = replaceStudioNode(graph, "iterator", "CODE", "Code");
    expect(replacement?.nodes[0]).toEqual({
      id: "iterator",
      type: "CODE",
      version: 1,
      name: "Code",
      config: initialConfig("CODE"),
    });
    expect(replacement?.edges).toEqual([{ ...graph.edges[1], sourcePort: "next" }]);
    expect(replacement?.layout).toEqual(graph.layout);
    expect(replacement?.entryNodeIds).toEqual(graph.entryNodeIds);
    if (replacement === null) throw new Error("Expected the selected iterator to exist");
    expect(replaceStudioNode(replacement, "iterator", "ITERATOR", "Iterator")?.edges).toEqual([
      graph.edges[1],
    ]);
    expect(replaceStudioNode(replacement, "iterator", "IF_ELSE", "If/Else")?.edges).toEqual([]);
    expect(replaceStudioNode(replacement, "iterator", "CODE", "Code")).toBe(replacement);
  });
  it("duplicates only the configured action, offsetting the detached copy", () => {
    const source = node("find", "FIND_RECORDS");
    const graph: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "manual", config: {} },
      nodes: [source, node("finish", "DELAY")],
      edges: [{ id: "next", source: "find", target: "finish", sourcePort: "next" }],
      entryNodeIds: ["find"],
      layout: { find: { x: 120, y: 240 } },
    };
    const duplicate = duplicateStudioNode(graph, "find", "copy");
    expect(duplicate?.nodes.at(-1)).toEqual({ ...source, id: "copy", name: "find (Duplicate)" });
    expect(duplicate?.nodes.at(-1)?.config).not.toBe(source.config);
    expect(duplicate?.layout).toEqual({ ...graph.layout, copy: { x: 170, y: 290 } });
    expect(duplicate?.edges).toEqual(graph.edges);
    expect(duplicate?.entryNodeIds).toEqual(graph.entryNodeIds);
    expect(duplicateStudioNode(graph, "$trigger", "copy")).toBeNull();
    expect(duplicateStudioNode(graph, "find", "finish")).toBeNull();
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

  it("offers only the governed revocation trigger fields with their persisted types", () => {
    const graph: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "newsletter.consent.revoked", config: { listId: 4 } },
      nodes: [node("check", "FILTER")],
      edges: [],
      entryNodeIds: ["check"],
    };
    const { choices, references } = studioVariables(graph, "check", {}, labels);
    expect(choices.map(({ path, type }) => ({ path, type }))).toEqual([
      { path: "", type: "object" },
      { path: "personId", type: "string" },
      { path: "linkId", type: "string" },
      { path: "listId", type: "number" },
      { path: "occurredAt", type: "instant" },
    ]);
    expect(references.get("$trigger:listId")).toEqual({
      kind: "reference",
      nodeId: "$trigger",
      path: ["listId"],
    });
  });
});
