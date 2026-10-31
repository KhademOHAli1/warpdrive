import { expect, it } from "vitest";
import { validateDefinition } from "./definition";
import { initialBlankDefinition } from "./editorModel";

it("starts a blank process with an automatic manual-start node", () => {
  const graph = initialBlankDefinition("شروع دستی");
  expect(graph.nodes).toHaveLength(1);
  expect(graph.nodes[0]?.nameMode).toBe("automatic");
  expect(graph.edges).toEqual([]);
  expect(validateDefinition(graph).ok).toBe(true);
});
