"use client";
import { type ReactNode, useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

export const PRIVATE = "ph-no-capture ph-block-email";
export function TextField({
  label,
  value,
  onChange,
  multiline,
  type = "text",
  maxLength = 200,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  type?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {multiline === true ? (
        <Textarea
          id={id}
          aria-label={label}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          aria-label={label}
          type={type}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
export function ChoiceField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Select
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
        contentClassName={PRIVATE}
        disabled={disabled}
      />
    </div>
  );
}
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-4 rounded-lg border p-5">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {description !== undefined ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
