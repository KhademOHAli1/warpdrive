import type { ChangeLogEntry } from "@/features/collaboration/changeLog";
import type { CustomFieldDef } from "@/types/customFields";

// Resolve known choices only for display. The audit trail retains its original values.
export function resolveCustomFieldOptions(
  entries: ChangeLogEntry[],
  defs: CustomFieldDef[],
): ChangeLogEntry[] {
  const choices = new Map(
    defs
      .filter(
        (def) =>
          def.type === "single_option" ||
          def.type === "multi_option" ||
          def.type === "autocomplete",
      )
      .map((def) => [
        `custom_field:${def.key}`,
        new Map(def.options.map((option) => [option.id, option.label])),
      ]),
  );
  return entries.map((entry) => {
    const labels = choices.get(entry.field);
    if (labels === undefined) return entry;
    const label = (value: unknown): unknown =>
      typeof value === "string" ? (labels.get(value) ?? value) : value;
    const resolve = (value: unknown): unknown =>
      Array.isArray(value) ? value.map(label) : label(value);
    return { ...entry, oldValue: resolve(entry.oldValue), newValue: resolve(entry.newValue) };
  });
}
