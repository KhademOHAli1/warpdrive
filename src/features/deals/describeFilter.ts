import type { ConditionFieldOption, RawCondition } from "@/components/filters/ConditionRows";
import { completeRowValue, type RowValue } from "@/components/filters/rowValue";
import { isDatePreset } from "@/constants/dateFilterPresets";
import { VALUELESS_OPS } from "@/constants/filterOps";
import { messagesForLocale } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

function optionLabel(def: ConditionFieldOption | undefined, value: string, locale: Locale): string {
  if (def?.input.kind === "date" && isDatePreset(value))
    return messagesForLocale(locale).filters.presets[value];
  if (def?.input.kind !== "select" && def?.input.kind !== "multiselect") return value;
  return def.input.options.find((o) => o.value === value)?.label ?? value;
}

// Human-readable value: a dropdown field resolves its stored id to the option's label (owner name,
// stage name, label name); free-text/number/date fields read as typed. A multi-value condition
// means "any of these", so its values read as alternatives.
function valueLabel(
  def: ConditionFieldOption | undefined,
  value: RowValue,
  locale: Locale,
): string {
  if (!Array.isArray(value)) return optionLabel(def, value, locale);
  return value.map((v) => optionLabel(def, v, locale)).join(locale === "fa" ? " یا " : " or ");
}

// A default filter name derived from the conditions, e.g. "Owner is Ada King and Value greater
// than 60000". Skips incomplete rows; empty when nothing is set yet. A valueless op reads as
// "Value is empty", with nothing after the operator.
export function describeRows(
  rows: readonly RawCondition[],
  fields: readonly ConditionFieldOption[],
  combinator: "and" | "or" = "and",
  locale: Locale = "en",
): string {
  const operators = new Map(Object.entries(messagesForLocale(locale).filters.operators));
  return rows
    .filter((r) => VALUELESS_OPS.has(r.op) || completeRowValue(r.value) !== null)
    .map((r) => {
      const def = fields.find((f) => f.field === r.field);
      const prefix = `${def?.label ?? r.field} ${operators.get(r.op) ?? r.op}`;
      return VALUELESS_OPS.has(r.op) ? prefix : `${prefix} ${valueLabel(def, r.value, locale)}`;
    })
    .join(
      combinator === "or" ? (locale === "fa" ? " یا " : " or ") : locale === "fa" ? " و " : " and ",
    );
}
