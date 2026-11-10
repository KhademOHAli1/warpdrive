"use client";
import { Bell, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/primitives/collapsible";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { ReminderEmailCapability } from "./CalendarReminderEditor";

export function CalendarReminderDisclosure({
  title,
  summary,
  disabled = false,
  reveal = false,
  error,
  emailUnavailable = false,
  children,
}: {
  title: string;
  summary: string;
  disabled?: boolean;
  reveal?: boolean;
  error?: string | null;
  emailUnavailable?: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();
  const open = expanded || reveal || error != null;
  return (
    <Collapsible open={open} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          disabled={disabled}
          aria-label={title}
          aria-describedby={descriptionId}
          className="h-auto min-h-9 w-full min-w-0 justify-start whitespace-normal px-0 py-1.5 text-start font-normal text-muted-foreground"
        >
          <Bell className="size-4 shrink-0" aria-hidden />
          <span className="shrink-0">{title}</span>
          <span id={descriptionId} className="min-w-0 text-xs">
            {summary}
          </span>
          {emailUnavailable && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {t("reminders.emailUnavailable")}
            </span>
          )}
          <ChevronDown
            data-disclosure-chevron
            data-state={open ? "open" : "closed"}
            data-rtl-mirror="false"
            className="ms-auto size-3.5 shrink-0"
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
      {/* Keep raw clock/number drafts mounted, but hidden controls cannot block the containing form.
        The parent receives validity and can reveal this section before attempting a save. */}
      <CollapsibleContent forceMount hidden={!open}>
        <fieldset disabled={disabled || !open} className="min-w-0 space-y-3 pb-2 ps-6 pt-2">
          {children}
          {error != null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </fieldset>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CalendarReminderEmailHint({
  capability,
}: {
  capability: ReminderEmailCapability;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  if (capability === "available") return null;
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {t(
        capability === "mailboxMissing" ? "reminders.mailboxMissing" : "reminders.channelDisabled",
      )}
    </p>
  );
}
