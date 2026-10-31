"use client";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { ActivityDraft } from "@/features/deal-workspace/composer/composerHelpers";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { CalendarEventDescription } from "./CalendarEventDescription";
import { CalendarMeetingField } from "./CalendarMeetingField";

export function CalendarEventDetails({
  draft,
  expanded,
  onChange,
}: {
  draft: ActivityDraft;
  expanded: boolean;
  onChange: (patch: Partial<ActivityDraft>) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [locationOpen, setLocationOpen] = useState(false);
  return (
    <div className="space-y-4">
      {expanded || locationOpen || draft.location !== "" ? (
        <div className="flex items-center gap-3">
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            aria-label={t("editor.location")}
            placeholder={t("editor.locationPlaceholder")}
            value={draft.location}
            maxLength={255}
            onChange={(event) => onChange({ location: event.target.value })}
            className="border-transparent bg-muted/25 hover:border-input"
          />
        </div>
      ) : (
        <Button
          variant="ghost"
          className="w-full justify-start px-0 font-normal text-muted-foreground"
          onClick={() => setLocationOpen(true)}
        >
          <MapPin className="me-2 size-4" aria-hidden />
          {t("editor.addLocation")}
        </Button>
      )}
      <CalendarMeetingField
        value={draft.videoCallUrl}
        onChange={(videoCallUrl) => onChange({ videoCallUrl })}
      />
      <CalendarEventDescription
        value={draft.note}
        expanded={expanded}
        onChange={(note) => onChange({ note })}
      />
    </div>
  );
}
