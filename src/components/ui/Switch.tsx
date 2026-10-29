"use client";
import type React from "react";
import { cn } from "@/lib/utils";
import { Switch as ShadcnSwitch } from "./primitives/switch";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
  disabled,
  className,
}: SwitchProps): React.ReactNode {
  return (
    <ShadcnSwitch
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "hover:not-disabled:ring-4 hover:not-disabled:ring-ring/15 data-[state=unchecked]:hover:not-disabled:bg-muted-foreground/40 motion-safe:active:not-disabled:scale-[0.96] data-checked:bg-success data-[state=checked]:hover:not-disabled:bg-success/85 motion-reduce:transition-none",
        className,
      )}
    />
  );
}
