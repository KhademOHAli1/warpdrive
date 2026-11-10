"use client";
import { ChevronDown, Link2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/primitives/collapsible";
import { isActivityPriorityKey } from "@/constants/activityPriorities";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { CalendarEventCrmDetails } from "./CalendarEventCrmDetails";
import { useActivitiesMessages } from "./useActivitiesMessages";

type Props = React.ComponentProps<typeof CalendarEventCrmDetails> & { reveal: boolean };

export function CalendarEventCrmDisclosure({ reveal, ...props }: Props): React.ReactNode {
  const t = useAppTranslations("calendar");
  const S = useActivitiesMessages();
  const [expanded, setExpanded] = useState(false);
  const open = expanded || reveal;
  const summary = [
    props.editing === undefined
      ? null
      : props.types.find((type) => type.id === props.draft.typeId)?.name,
    isActivityPriorityKey(props.draft.priority) ? S.priorities[props.draft.priority] : null,
    props.editing?.dealTitle ?? props.editing?.personName ?? props.editing?.orgName,
  ]
    .filter((part) => part != null && part !== "")
    .join(" · ");
  return (
    <Collapsible open={open} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          aria-label={t("editor.crmDetails")}
          className="w-full min-w-0 justify-start px-0 font-normal text-muted-foreground"
        >
          <Link2 className="size-4 shrink-0" aria-hidden />
          <span className="shrink-0">{t("editor.crmDetails")}</span>
          <bdi dir="auto" className="min-w-0 truncate text-xs">
            {summary}
          </bdi>
          <ChevronDown
            data-disclosure-chevron
            data-state={open ? "open" : "closed"}
            data-rtl-mirror="false"
            className="ms-auto size-3.5 shrink-0"
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <CalendarEventCrmDetails {...props} />
      </CollapsibleContent>
    </Collapsible>
  );
}
