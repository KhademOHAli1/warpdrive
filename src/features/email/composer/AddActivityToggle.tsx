"use client";
import { Info } from "lucide-react";
import { useEmailMessages } from "@/features/email/useEmailMessages";
// AddActivityToggle: footer checkbox that (when checked) causes a successful
// email send to log a deal-linked activity. Only rendered in deal context.

import { ToggleField } from "@/components/ui/ToggleField";
import { Tip } from "@/components/ui/tooltip";

interface AddActivityToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function AddActivityToggle({ checked, onChange }: AddActivityToggleProps): React.ReactNode {
  const E = useEmailMessages();

  return (
    <ToggleField
      label={E._composer.addAsActivityLabel}
      checked={checked}
      onCheckedChange={onChange}
    >
      <Tip label={E._composer.addAsActivityTooltip}>
        <span
          role="img"
          aria-label={E._composer.addAsActivityTooltip}
          className="inline-flex items-center justify-center h-3.5 w-3.5 text-muted-foreground/70 text-[10px] leading-none ms-0.5 cursor-help"
        >
          <Info aria-hidden="true" className="size-3.5" />
        </span>
      </Tip>
    </ToggleField>
  );
}
