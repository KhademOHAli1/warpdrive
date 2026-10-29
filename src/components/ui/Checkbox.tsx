"use client";
import type React from "react";
import { cn } from "@/lib/utils";
import { Checkbox as ShadcnCheckbox } from "./primitives/checkbox";

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
  return (
    <ShadcnCheckbox
      id={id}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "rounded-sm border-muted-foreground/50 data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:before:absolute data-[state=indeterminate]:before:h-0.5 data-[state=indeterminate]:before:w-2 data-[state=indeterminate]:before:bg-current data-[state=indeterminate]:[&_svg]:hidden motion-reduce:transition-none",
        className,
      )}
    />
  );
}
