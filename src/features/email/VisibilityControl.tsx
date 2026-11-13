"use client";

import { Lock, LockOpen } from "lucide-react";
import type React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { INLINE_CONTROL_SURFACE } from "@/components/ui/inlineControlSurface";
import { cn } from "@/lib/utils";
import type { EmailVisibility } from "./threadVisibility";
import { useEmailMessages } from "./useEmailMessages";

type VisibilityControlProps = {
  onChange: (value: EmailVisibility) => void;
} & (
  | { variant?: "composer"; value: EmailVisibility }
  | { variant: "reader"; value: string; disabled: boolean }
);

function stopPropagation(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function VisibilityControl(props: VisibilityControlProps): React.ReactNode {
  const E = useEmailMessages();
  const isPrivate = props.value === "private";
  const Glyph = isPrivate ? Lock : LockOpen;
  const reader = props.variant === "reader";
  const labels: Record<EmailVisibility, string> = reader
    ? { private: E._extra.private, shared: E._extra.shared }
    : { private: E._composer.visibilityPrivateLabel, shared: E._composer.visibilityLabel };
  const triggerLabel = reader
    ? isPrivate
      ? E._extra.private_conversation
      : E._extra.shared_conversation
    : E._composer.visibilityPickerLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={triggerLabel}
        disabled={reader ? props.disabled : undefined}
        onClick={reader ? stopPropagation : undefined}
        onPointerDown={reader ? stopPropagation : undefined}
        className={
          reader
            ? "inline-flex rounded p-1 text-muted-foreground transition-transform hover:bg-accent hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            : cn(
                INLINE_CONTROL_SURFACE,
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )
        }
      >
        <Glyph aria-hidden="true" className={cn("h-3.5 w-3.5", !reader && "shrink-0")} />
        {!reader && labels[isPrivate ? "private" : "shared"]}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-40"
        onClick={reader ? stopPropagation : undefined}
      >
        {(["private", "shared"] as const).map((value) => (
          <DropdownMenuItem
            key={value}
            aria-label={reader ? undefined : labels[value]}
            className={reader ? undefined : "text-xs"}
            onSelect={() => props.onChange(value)}
          >
            {labels[value]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
