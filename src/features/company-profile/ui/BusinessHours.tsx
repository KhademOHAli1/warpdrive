"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CompanyDetails } from "../contracts";
import { useCompanyMessages } from "../messages";
import { ChoiceField, TextField } from "./Fields";

export function BusinessHours({
  value,
  onChange,
  disabled,
}: {
  value: CompanyDetails["businessHours"];
  onChange: (value: CompanyDetails["businessHours"]) => void;
  disabled: boolean;
}) {
  const m = useCompanyMessages();
  const [rowKeys, setRowKeys] = useState(() => value.map(() => crypto.randomUUID()));
  const days = [m.sunday, m.monday, m.tuesday, m.wednesday, m.thursday, m.friday, m.saturday];
  const update = (index: number, patch: Partial<CompanyDetails["businessHours"][number]>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="col-span-full space-y-3">
      {value.map((row, i) => (
        <div key={rowKeys[i]} className="grid gap-3 sm:grid-cols-4">
          <ChoiceField
            label={`${m.day} ${i + 1}`}
            value={String(row.day)}
            options={days.map((label, day) => ({ value: String(day), label }))}
            onChange={(day) => update(i, { day: Number(day) })}
            disabled={disabled}
          />
          <TextField
            label={`${m.opens} ${i + 1}`}
            value={row.opens}
            type="time"
            onChange={(opens) => update(i, { opens })}
            disabled={disabled}
          />
          <TextField
            label={`${m.closes} ${i + 1}`}
            value={row.closes}
            type="time"
            onChange={(closes) => update(i, { closes })}
            disabled={disabled}
          />
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setRowKeys(rowKeys.filter((_, index) => i !== index));
              onChange(value.filter((_, index) => i !== index));
            }}
          >
            {m.remove}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={disabled || value.length >= 28}
        onClick={() => {
          setRowKeys([...rowKeys, crypto.randomUUID()]);
          onChange([...value, { day: 1, opens: "09:00", closes: "17:00" }]);
        }}
      >
        {m.add}
      </Button>
    </div>
  );
}
