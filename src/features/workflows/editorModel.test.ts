import { expect, it } from "vitest";
import { validateDefinition } from "./definition";
import { initialDefinition } from "./editorModel";

it("creates a valid localized follow-up template with explicit edges", () => {
  const labels = {
    start: "شروع دستی",
    read: "خواندن اطلاعات معامله",
    task: "ایجاد کار",
    subject: "پیگیری مشتری",
  };
  const original = initialDefinition(labels);
  expect(validateDefinition(original).ok).toBe(true);
  expect(original.nodes).toHaveLength(3);
  expect(original.edges).toEqual([
    { from: "start", to: "read", port: "next" },
    { from: "read", to: "task", port: "next" },
  ]);
});
