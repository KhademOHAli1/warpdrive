"use client";
import { Switch as SdkSwitch, SwitchThumb } from "@ui-sdk/react/switch";
import type React from "react";
import { cn } from "@/lib/utils";

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
  const state = checked ? "checked" : "unchecked";
  return (
    <SdkSwitch
      id={id}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      aria-label={label}
      disabled={disabled}
      data-state={state}
      data-size="default"
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        // In Warpdrive Enter toggles the switch, including inside the invitation form.
        event.preventDefault();
        if (!event.repeat && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
          event.currentTarget.click();
        }
      }}
      className={cn(
        "peer relative inline-flex h-[18.4px] w-8 shrink-0 items-center rounded-full border border-transparent transition-all outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "hover:not-disabled:ring-4 hover:not-disabled:ring-ring/15 data-[state=unchecked]:hover:not-disabled:bg-muted-foreground/40 motion-safe:active:not-disabled:scale-[0.96] data-checked:bg-success data-[state=checked]:hover:not-disabled:bg-success/85 motion-reduce:transition-none",
        className,
      )}
    >
      <SwitchThumb
        data-state={state}
        className="pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform data-checked:translate-x-[calc(100%-2px)] rtl:data-checked:-translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground motion-reduce:transition-none"
      />
    </SdkSwitch>
  );
}
