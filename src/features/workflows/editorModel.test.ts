import { expect, it } from "vitest";
import { validateDefinition } from "./definition";
import { appendTask, initialDefinition, removeTask } from "./editorModel";

it("creates a valid localized flow and preserves bindings when tasks are added and removed", () => {
  const labels = {
    start: "شروع دستی",
    read: "خواندن اطلاعات معامله",
    task: "ایجاد کار",
    subject: "پیگیری مشتری",
  };
  const original = initialDefinition(labels);
  expect(validateDefinition(original).ok).toBe(true);
  const added = appendTask(original, "task2", labels.task, "Nachfassen");
  expect(validateDefinition(added).ok).toBe(true);
  expect(original.nodes).toHaveLength(3);
  const removed = removeTask(added, "task");
  expect(removed.nodes).toHaveLength(3);
  expect(validateDefinition(removed).ok).toBe(true);
  expect(removeTask(removed, "read")).toEqual(removed);
});
