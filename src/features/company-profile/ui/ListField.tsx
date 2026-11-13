"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useCompanyMessages } from "../messages";
export function ListField({
  label,
  value,
  onChange,
  disabled,
  max = 20,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const m = useCompanyMessages();
  const [entry, setEntry] = useState("");
  const add = () => {
    if (entry.trim() && !value.includes(entry.trim()) && value.length < max) {
      onChange([...value, entry.trim()]);
      setEntry("");
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">{label}</p>
      <ul className="space-y-1">
        {value.map((item, index) => (
          <li key={item} className="flex items-center justify-between gap-2">
            <bdi className="truncate">{item}</bdi>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`${m.remove}: ${label} ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => index !== i))}
            >
              {m.remove}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-label={label}
          value={entry}
          disabled={disabled}
          maxLength={2048}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            event.preventDefault();
            add();
          }}
        />
        <Button
          variant="outline"
          disabled={disabled === true || !entry.trim() || value.length >= max}
          onClick={add}
        >
          {m.add}
        </Button>
      </div>
    </div>
  );
}
