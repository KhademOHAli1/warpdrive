"use client";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { ChoiceField, TextField } from "@/features/company-profile/ui/Fields";
import { ListField } from "@/features/company-profile/ui/ListField";
import type { WorkFieldDefinition } from "../contracts";
import { useWorkMessages } from "../messages";
export function TypeFields({
  value,
  onChange,
  disabled,
}: {
  value: WorkFieldDefinition[];
  onChange: (value: WorkFieldDefinition[]) => void;
  disabled: boolean;
}) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const update = (index: number, patch: Partial<WorkFieldDefinition>) =>
    onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  const types = ["text", "long_text", "number", "date", "select", "boolean"] as const;
  return (
    <div className="space-y-3">
      <h3 className="font-medium">{m.fields}</h3>
      {value.map((field, index) => (
        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2" key={field.key}>
          <TextField
            label={`${m.key} ${index + 1}`}
            value={field.key}
            maxLength={80}
            disabled={true}
            onChange={(key) => update(index, { key })}
          />
          <TextField
            label={`${m.label} ${index + 1}`}
            value={field.label}
            maxLength={120}
            disabled={disabled}
            onChange={(label) => update(index, { label })}
          />
          <ChoiceField
            label={`${m.fieldType} ${index + 1}`}
            value={field.type}
            options={types.map((type) => ({ value: type, label: m[type] }))}
            disabled={disabled}
            onChange={(value) => {
              const type = types.find((entry) => value === entry);
              if (type) update(index, { type, options: [] });
            }}
          />
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              label={`${m.required} ${index + 1}`}
              checked={field.required}
              disabled={disabled}
              onCheckedChange={(required) => update(index, { required })}
            />
            {m.required}
          </div>
          {field.type === "select" ? (
            <ListField
              label={`${m.choices} ${index + 1}`}
              value={field.options}
              max={50}
              disabled={disabled}
              onChange={(options) => update(index, { options })}
            />
          ) : null}
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, i) => index !== i))}
          >
            {c.remove}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={disabled || value.length >= 40}
        onClick={() =>
          onChange([
            ...value,
            {
              key: `field_${crypto.randomUUID().slice(0, 8)}`,
              label: "",
              type: "text",
              options: [],
              required: false,
            },
          ])
        }
      >
        {c.add}
      </Button>
    </div>
  );
}
