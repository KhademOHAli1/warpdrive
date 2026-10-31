import { expect, it } from "vitest";
import { displayNodeName } from "./nodeNames";
import type { WorkflowNode } from "./schemas";

it("localizes automatic and recognized legacy defaults while keeping custom names", () => {
  const node: WorkflowNode = {
    id: "task",
    type: "activity.create",
    version: 1,
    name: "Create task",
    config: {},
  };
  expect(displayNodeName(node, "fa")).toBe("ایجاد کار");
  expect(displayNodeName(node, "de")).toBe("Aufgabe erstellen");
  expect(displayNodeName({ ...node, nameMode: "custom" }, "fa")).toBe("Create task");
  expect(displayNodeName({ ...node, name: "پیگیری قرارداد" }, "de")).toBe("پیگیری قرارداد");
});
