"use client";
import { Button } from "@/components/ui/Button";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { ChoiceField, TextField } from "@/features/company-profile/ui/Fields";
import type { StageDraft } from "../contracts";
import { useWorkMessages } from "../messages";
export function TypeStages({
  value,
  onChange,
  disabled,
}: {
  value: StageDraft[];
  onChange: (value: StageDraft[]) => void;
  disabled: boolean;
}) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const update = (index: number, patch: Partial<StageDraft>) =>
    onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  return (
    <div className="space-y-3">
      <h3 className="font-medium">{m.stages}</h3>
      {value.map((stage, index) => (
        <div key={stage.key} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
          <TextField
            label={`${m.key} ${index + 1}`}
            value={stage.key}
            maxLength={80}
            disabled={true}
            onChange={(key) => update(index, { key })}
          />
          <TextField
            label={`${c.name} ${index + 1}`}
            value={stage.name}
            maxLength={120}
            disabled={disabled}
            onChange={(name) => update(index, { name })}
          />
          <ChoiceField
            label={`${m.bucket} ${index + 1}`}
            value={stage.bucket}
            options={(["open", "complete", "canceled"] as const).map((bucket) => ({
              value: bucket,
              label: m[bucket],
            }))}
            disabled={disabled}
            onChange={(bucket) => {
              if (bucket === "open" || bucket === "complete" || bucket === "canceled")
                update(index, { bucket });
            }}
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={disabled || index === 0}
              aria-label={m.moveEarlier}
              onClick={() => {
                const previous = value[index - 1];
                const current = value[index];
                if (previous && current) {
                  const result = [...value];
                  result[index - 1] = current;
                  result[index] = previous;
                  onChange(result);
                }
              }}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              disabled={disabled || value.length <= 1}
              onClick={() => onChange(value.filter((_, i) => index !== i))}
            >
              {c.remove}
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={disabled || value.length >= 30}
        onClick={() =>
          onChange([
            ...value,
            { key: `stage_${crypto.randomUUID().slice(0, 8)}`, name: "", bucket: "open" },
          ])
        }
      >
        {c.add}
      </Button>
    </div>
  );
}
