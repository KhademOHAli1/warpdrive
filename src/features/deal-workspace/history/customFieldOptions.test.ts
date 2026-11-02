import { expect, it } from "vitest";
import type { ChangeLogEntry } from "@/features/collaboration/changeLog";
import type { CustomFieldDef } from "@/types/customFields";
import { resolveCustomFieldOptions } from "./customFieldOptions";

it("shows option labels in field history without changing stored audit values or authored text", () => {
  const def = {
    key: "priority",
    type: "single_option",
    options: [
      { id: "high-id", label: "High" },
      { id: "normal-id", label: "Normal" },
    ],
  } as CustomFieldDef;
  const entry = {
    field: "custom_field:priority",
    oldValue: "high-id",
    newValue: "normal-id",
  } as ChangeLogEntry;
  const authored = { ...entry, field: "title" };
  const result = resolveCustomFieldOptions([entry, authored], [def]);
  expect(result[0]).toMatchObject({ oldValue: "High", newValue: "Normal" });
  expect(entry.newValue).toBe("normal-id");
  expect(result[1]).toBe(authored);
});

it("handles multiple options and preserves missing definitions and unresolved historical options", () => {
  const def = {
    key: "segments",
    type: "multi_option",
    options: [{ id: "a", label: "Enterprise" }],
  } as CustomFieldDef;
  const entry = {
    field: "custom_field:segments",
    oldValue: null,
    newValue: ["a", "removed"],
  } as ChangeLogEntry;
  expect(resolveCustomFieldOptions([entry], [def])[0]?.newValue).toEqual(["Enterprise", "removed"]);
  expect(resolveCustomFieldOptions([entry], [])[0]).toBe(entry);
});
