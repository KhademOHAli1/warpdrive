"use client";
import { Checkbox as SdkCheckbox } from "@ui-sdk/react/checkbox";
import { Check } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  checked: boolean | "indeterminate";
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

// The CRM exposes a boolean change callback and preserves its mixed select-all indicator.
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
  disabled,
  className,
}: CheckboxProps): React.ReactNode {
  const state = checked === "indeterminate" ? checked : checked ? "checked" : "unchecked";
  return (
    <SdkCheckbox
      id={id}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      aria-label={label}
      data-slot="checkbox"
      data-state={state}
      onKeyDown={(event) => {
        // Preserve the checkbox's Enter behavior inside forms. Space still toggles it.
        if (event.key === "Enter") event.preventDefault();
      }}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center border transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary",
        "rounded-sm border-muted-foreground/50 data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:before:absolute data-[state=indeterminate]:before:h-0.5 data-[state=indeterminate]:before:w-2 data-[state=indeterminate]:before:bg-current data-[state=indeterminate]:[&_svg]:hidden motion-reduce:transition-none",
        className,
      )}
    >
      {checked !== false && (
        <span
          aria-hidden="true"
          data-slot="checkbox-indicator"
          data-state={state}
          className="pointer-events-none grid place-content-center text-current"
        >
          <Check className="size-3.5" />
        </span>
      )}
    </SdkCheckbox>
  );
}
