"use client";
import { ChevronDown, Globe2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { Combobox } from "@/components/ui/Combobox";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function CalendarEventTimeZone({
  value,
  onChange,
  label,
  hint,
  compact = false,
  reveal = false,
}: {
  value: string;
  onChange: (zone: string) => void;
  label?: string;
  hint?: string;
  compact?: boolean;
  reveal?: boolean;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [expanded, setExpanded] = useState(false);
  const open = expanded || reveal;
  const title = label ?? t("editor.eventTimeZone");
  const options = useMemo(
    () =>
      Array.from(new Set([value, "UTC", ...Intl.supportedValuesOf("timeZone")]))
        .sort()
        .map((zone) => ({ value: zone, label: zone })),
    [value],
  );
  const fields = (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <Combobox ariaLabel={title} value={value} options={options} onChange={onChange} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {hint ?? t("editor.eventTimeZoneHint")}
      </p>
    </div>
  );
  if (!compact) return fields;
  return (
    <Collapsible open={open} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${title}: ${value}`}
          className="max-w-full justify-start px-0 font-normal text-muted-foreground"
        >
          <Globe2 className="size-3.5 shrink-0" aria-hidden />
          <bdi dir="ltr" className="truncate">
            {value}
          </bdi>
          <ChevronDown
            data-disclosure-chevron
            data-state={open ? "open" : "closed"}
            data-rtl-mirror="false"
            className="size-3 shrink-0"
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="max-w-sm pb-2 pt-2">{fields}</CollapsibleContent>
    </Collapsible>
  );
}
