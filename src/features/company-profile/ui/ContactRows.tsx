"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CompanyDetails } from "../contracts";
import { useCompanyMessages } from "../messages";
import { ChoiceField, TextField } from "./Fields";

type Contact = CompanyDetails["roleContacts"][number];
export function ContactRows({
  value,
  onChange,
  disabled = false,
}: {
  value: Contact[];
  onChange: (value: Contact[]) => void;
  disabled?: boolean;
}) {
  const m = useCompanyMessages();
  const [rowKeys, setRowKeys] = useState(() => value.map(() => crypto.randomUUID()));
  const roles = [
    "executive",
    "billing",
    "support",
    "security",
    "privacy",
    "finance",
    "procurement",
    "other",
  ] as const;
  const update = (index: number, patch: Partial<Contact>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="col-span-full space-y-4">
      {value.map((row, index) => (
        <div key={rowKeys[index]} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
          <TextField
            label={`${m.name} ${index + 1}`}
            value={row.name}
            onChange={(name) => update(index, { name })}
            disabled={disabled}
          />
          <ChoiceField
            label={`${m.role} ${index + 1}`}
            value={row.role}
            options={roles.map((role) => ({ value: role, label: m[role] }))}
            onChange={(role) => {
              const selected = roles.find((entry) => entry === role);
              if (selected) update(index, { role: selected });
            }}
            disabled={disabled}
          />
          <TextField
            label={`${m.email} ${index + 1}`}
            type="email"
            value={row.email}
            onChange={(email) => update(index, { email })}
            disabled={disabled}
          />
          <TextField
            label={`${m.phone} ${index + 1}`}
            value={row.phone}
            onChange={(phone) => update(index, { phone })}
            disabled={disabled}
          />
          <TextField
            label={`${m.purpose} ${index + 1}`}
            value={row.purpose}
            maxLength={500}
            onChange={(purpose) => update(index, { purpose })}
            disabled={disabled}
          />
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setRowKeys(rowKeys.filter((_, i) => index !== i));
              onChange(value.filter((_, i) => index !== i));
            }}
          >
            {m.remove}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={disabled || value.length >= 20}
        onClick={() => {
          setRowKeys([...rowKeys, crypto.randomUUID()]);
          onChange([...value, { name: "", role: "other", email: "", phone: "", purpose: "" }]);
        }}
      >
        {m.add}
      </Button>
    </div>
  );
}
