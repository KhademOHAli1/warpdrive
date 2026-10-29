"use client";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { TimePicker } from "@/components/ui/TimePicker";

export { NumericControl } from "./render.numeric-control";
export { ReferenceControl } from "./render.reference-control";

// Per-type form control components for custom fields.
// Each component is small and focused; the dispatch lives in render.widgets.tsx.
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { normalizeDigits } from "@/utils/normalizeNumberInput";
import type { ControlProps } from "./render.widget-types";
import { addrVal, rangeVal, strVal } from "./render.widget-types";

export function TextControl({ id, def, value, onChange }: ControlProps & { id: string }) {
  return (
    <Input
      id={id}
      type="text"
      dir={def.type === "phone" ? "ltr" : "auto"}
      inputMode={def.type === "phone" ? "tel" : undefined}
      value={strVal(value)}
      onChange={(e) =>
        onChange(def.type === "phone" ? normalizeDigits(e.target.value) : e.target.value)
      }
      aria-label={def.name}
      className="h-8 px-2 py-1"
    />
  );
}

export function LargeTextControl({ id, def, value, onChange }: ControlProps & { id: string }) {
  return (
    <Textarea
      id={id}
      value={strVal(value)}
      dir="auto"
      onChange={(e) => onChange(e.target.value)}
      aria-label={def.name}
      className="min-h-20 px-2 py-1.5"
    />
  );
}

export function DateControl({ def, value, onChange }: ControlProps & { id: string }) {
  const v = strVal(value);
  return (
    <DatePicker
      ariaLabel={def.name}
      value={v === "" ? null : v}
      onChange={(next) => onChange(next ?? "")}
    />
  );
}

export function TimeControl({ def, value, onChange }: ControlProps & { id: string }) {
  return <TimePicker ariaLabel={def.name} value={strVal(value)} onChange={onChange} />;
}

export function RangeControl({
  def,
  value,
  onChange,
  inputType,
}: ControlProps & { inputType: "date" | "time" }) {
  const t = useAppTranslations("customFields");
  const range = rangeVal(value);
  return (
    <fieldset className="m-0 space-y-2 border-0 p-0">
      <legend className="sr-only">{def.name}</legend>
      {(["start", "end"] as const).map((part) => (
        <div key={part} className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t(part)}</span>
          {inputType === "date" ? (
            <DatePicker
              ariaLabel={t(part === "start" ? "rangeStart" : "rangeEnd", { name: def.name })}
              value={range[part] === "" ? null : range[part]}
              onChange={(next) => onChange({ ...range, [part]: next ?? "" })}
            />
          ) : (
            <TimePicker
              ariaLabel={t(part === "start" ? "rangeStart" : "rangeEnd", { name: def.name })}
              value={range[part]}
              onChange={(next) => onChange({ ...range, [part]: next })}
            />
          )}
        </div>
      ))}
    </fieldset>
  );
}

// Options archived in settings are dropped from the picker so they cannot be chosen for new
// records, but an option that is already the stored value stays visible so historical data
// still reads correctly and can be deselected.
function pickableOptions(def: ControlProps["def"], selectedIds: string[]) {
  return def.options.filter((o) => o.archived !== true || selectedIds.includes(o.id));
}

export function SingleOptionControl({ def, value, onChange }: ControlProps & { id: string }) {
  const t = useAppTranslations("customFields");
  const current = strVal(value);
  return (
    <Select
      ariaLabel={def.name}
      value={current}
      onChange={onChange}
      placeholder={t("select")}
      options={[
        { value: "", label: t("select") },
        ...pickableOptions(def, current === "" ? [] : [current]).map((o) => ({
          value: o.id,
          label: o.label,
        })),
      ]}
    />
  );
}

export function MultiOptionControl({ def, value, onChange }: ControlProps) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  return (
    <fieldset className="m-0 space-y-1 border-0 p-0">
      <legend className="sr-only">{def.name}</legend>
      {pickableOptions(def, selected).map((o) => (
        <div key={o.id} className="flex min-h-8 items-center gap-2 rounded px-1 hover:bg-accent">
          <Checkbox
            label={o.label}
            checked={selected.includes(o.id)}
            onCheckedChange={(v) => {
              const next = v ? [...selected, o.id] : selected.filter((s) => s !== o.id);
              onChange(next);
            }}
          />
          <bdi dir="auto">{o.label}</bdi>
        </div>
      ))}
    </fieldset>
  );
}

export function AddressControl({ def, value, onChange }: ControlProps) {
  const t = useAppTranslations("customFields");
  const a = addrVal(value);
  const fields: Array<[string, string]> = [
    ["street", t("street")],
    ["city", t("city")],
    ["region", t("region")],
    ["postal", t("postal")],
    ["country", t("country")],
  ];
  return (
    <fieldset className="m-0 space-y-2 border-0 p-0">
      <legend className="sr-only">{def.name}</legend>
      {fields.map(([name, label]) => {
        const id = `cf-${def.key}-${name}`;
        return (
          <label
            key={name}
            htmlFor={id}
            className="block text-xs font-medium text-muted-foreground"
          >
            {label}
            <Input
              id={id}
              type="text"
              dir="auto"
              value={a[name] ?? ""}
              onChange={(e) => onChange({ ...a, [name]: e.target.value })}
              className="mt-1 h-8 px-2 py-1 text-foreground"
            />
          </label>
        );
      })}
    </fieldset>
  );
}
