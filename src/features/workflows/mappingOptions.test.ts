import { expect, it } from "vitest";
import { initialDefinition } from "./editorModel";
import { mappingOptions } from "./mappingOptions";

it("offers only connected ancestors and entity-compatible deal references", () => {
  const graph = initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" });
  expect(mappingOptions(graph, "task", "deal").map((item) => item.key)).toEqual([
    "start.recordId",
    "read.id",
  ]);
  expect(mappingOptions(graph, "read", "text").some((item) => item.key.startsWith("task."))).toBe(
    false,
  );
  expect(mappingOptions({ ...graph, edges: [] }, "task", "deal")).toEqual([]);
});
