"use client";

import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useSharedBlocksMessages } from "../sharedBlocksMessages";

export function BlockField({
  label,
  children,
  help,
  error,
}: {
  label: string;
  children: ReactNode;
  help?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <fieldset
      className="min-w-0 space-y-1.5"
      aria-label={label}
      aria-invalid={error !== undefined}
      aria-describedby={error === undefined ? undefined : id}
    >
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</legend>
      {children}
      {help !== undefined && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{help}</p>
      )}
      {error !== undefined && (
        <p id={id} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function BlockBindingField({
  label,
  children,
  reference,
  onVariable,
  onLiteral,
  disabled = false,
  help,
  error,
}: {
  label: string;
  children: ReactNode;
  reference?: string;
  onVariable: () => void;
  onLiteral: () => void;
  disabled?: boolean;
  help?: string;
  error?: string;
}) {
  const L = useSharedBlocksMessages();
  return (
    <BlockField label={label} help={help} error={error}>
      <div className="flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {reference === undefined ? (
            children
          ) : (
            <div className="flex min-h-9 items-center gap-2 rounded-md border bg-muted/30 px-2.5 text-xs">
              <span className="min-w-0 flex-1 break-words" dir="auto">
                {reference}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="size-6 shrink-0 p-0"
                disabled={disabled}
                aria-label={`${L.literal}: ${label}`}
                onClick={onLiteral}
              >
                ×
              </Button>
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9 shrink-0 px-2 text-xs font-mono"
          disabled={disabled}
          aria-label={`${L.chooseVariable}: ${label}`}
          onClick={onVariable}
        >
          (x)
        </Button>
      </div>
    </BlockField>
  );
}
