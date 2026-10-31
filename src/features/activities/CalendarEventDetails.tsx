"use client";
import { MapPin, StickyNote, Video } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ACTIVITY_PRIORITY_KEYS } from "@/constants/activityPriorities";
import { ComposerFieldRow } from "@/features/deal-workspace/composer/ComposerFieldRow";
import type { ActivityDraft } from "@/features/deal-workspace/composer/composerHelpers";
import { RichTextBody } from "@/features/email/composer/RichTextBodyLazy";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useActivitiesMessages } from "./useActivitiesMessages";

export function CalendarEventDetails({
  draft,
  onChange,
}: {
  draft: ActivityDraft;
  onChange: (patch: Partial<ActivityDraft>) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const S = useActivitiesMessages();
  return (
    <div className="space-y-5 border-t pt-5">
      <Select
        ariaLabel={S.priority}
        value={draft.priority}
        onChange={(priority) => onChange({ priority })}
        options={[
          { value: "", label: S.noPriority },
          ...ACTIVITY_PRIORITY_KEYS.map((key) => ({
            value: key,
            label: S.priorities[key],
          })),
        ]}
      />
      <ComposerFieldRow icon={<MapPin className="size-4" />}>
        <Input
          aria-label={t("editor.location")}
          placeholder={t("editor.locationPlaceholder")}
          value={draft.location}
          maxLength={255}
          onChange={(event) => onChange({ location: event.target.value })}
        />
      </ComposerFieldRow>
      <ComposerFieldRow icon={<Video className="size-4" />} iconAlign="top">
        <div className="space-y-1.5">
          <Input
            aria-label={t("editor.meetingLink")}
            dir="ltr"
            type="url"
            value={draft.videoCallUrl}
            maxLength={2048}
            onChange={(event) => onChange({ videoCallUrl: event.target.value })}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("editor.meetingLinkHint")}
          </p>
        </div>
      </ComposerFieldRow>
      <ComposerFieldRow icon={<StickyNote className="size-4" />} iconAlign="top">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">{t("editor.description")}</p>
          <div className="overflow-hidden rounded-md border bg-warning/10">
            <RichTextBody
              ariaLabel={t("editor.description")}
              html={draft.note}
              onChange={(note) => onChange({ note })}
            />
          </div>
        </div>
      </ComposerFieldRow>
    </div>
  );
}
