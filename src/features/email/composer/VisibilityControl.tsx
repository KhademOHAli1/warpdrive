"use client";

import { useEmailMessages } from "@/features/email/useEmailMessages";
// VisibilityControl (C1): interactive composer privacy picker. A shadcn DropdownMenu (never a
// native <select>) offering Private / Shared. The chosen value is lifted into composer state and
// threaded into the send payload (useComposerSend -> sendEmailInput.visibility) so the sent thread
// lands with the visibility the author picked. Private = closed padlock; shared = open padlock.

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
import type { EmailVisibility } from "../threadVisibility";

interface VisibilityControlProps {
  value: EmailVisibility;
  onChange: (value: EmailVisibility) => void;
}

// Closed padlock (private) or open padlock (shared), matching the ThreadPrivacyToggle glyph so the
// compose and reader controls read as the same affordance.
function LockGlyph({ open }: { open: boolean }): React.ReactNode {
  const Glyph = open ? LockOpen : Lock;
  return <Glyph aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
}

export function VisibilityControl({ value, onChange }: VisibilityControlProps): React.ReactNode {
  const E = useEmailMessages();

  const isPrivate = value === "private";
  const label = isPrivate ? E._composer.visibilityPrivateLabel : E._composer.visibilityLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={E._composer.visibilityPickerLabel}
        className={cn(
          INLINE_CONTROL_SURFACE,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <LockGlyph open={!isPrivate} />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem
          aria-label={E._composer.visibilityPrivateLabel}
          className="text-xs"
          onSelect={() => onChange("private")}
        >
          {E._composer.visibilityPrivateLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          aria-label={E._composer.visibilityLabel}
          className="text-xs"
          onSelect={() => onChange("shared")}
        >
          {E._composer.visibilityLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
