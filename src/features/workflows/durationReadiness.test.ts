import { expect, it } from "vitest";
import { validateDefinition } from "./definition";
import { initialBlankDefinition } from "./editorModel";
import {
  draftExecutableDefinition,
  draftExecutableNode,
  executableDefinition,
  executableNode,
} from "./readiness";
import { actionRegistry } from "./registry";
import type { Binding, WorkflowDefinition, WorkflowNode } from "./schemas";

function durationNode(minutes: Binding): WorkflowNode {
  return {
    id: "wait",
    type: "delay",
    version: 1,
    name: "Wait",
    nameMode: "automatic",
    config: { minutes },
  };
}

function definitionWithWait(wait: WorkflowNode): WorkflowDefinition {
  const definition = initialBlankDefinition("Manual start");
  return {
    ...definition,
    nodes: [...definition.nodes, wait],
    edges: [{ from: "start", to: wait.id, port: "next" }],
  };
}

// Desired public gate after durable-handler qualification; existing closed-gate tests stay intact.
it.each([1, 525600])("makes a literal wait of %i minutes publication-ready", (minutes) => {
  const wait = durationNode({ kind: "value", value: minutes });
  const definition = definitionWithWait(wait);
  expect(validateDefinition(definition).ok).toBe(true);
  expect(executableNode(wait)).toBe(true);
  expect(executableDefinition(definition)).toBe(true);
});

it("keeps a reference duration publication-unready even though its configuration is authorable", () => {
  const wait = durationNode({ kind: "reference", nodeId: "start", path: ["recordId"] });
  expect(actionRegistry.delay.config.safeParse(wait.config).success).toBe(true);
  expect(executableNode(wait)).toBe(false);
  expect(executableDefinition(definitionWithWait(wait))).toBe(false);
});

it.each([0, 1.5, 525601, "1"])(
  "keeps invalid literal duration %j publication-unready",
  (minutes) => {
    const wait = durationNode({ kind: "value", value: minutes });
    expect(executableNode(wait)).toBe(false);
    expect(executableDefinition(definitionWithWait(wait))).toBe(false);
  },
);

it("keeps published fixed-instant waits out of the duration-only draft gate", () => {
  const wait: WorkflowNode = {
    id: "wait",
    type: "delay",
    version: 1,
    name: "Wait",
    nameMode: "automatic",
    config: {
      until: {
        kind: "value",
        literalType: "instant",
        value: "2030-03-20T12:00:00.000Z",
      },
    },
  };
  const definition = definitionWithWait(wait);
  expect(executableNode(wait)).toBe(true);
  expect(executableDefinition(definition)).toBe(true);
  expect(draftExecutableNode(wait)).toBe(false);
  expect(draftExecutableDefinition(definition)).toBe(false);
});
