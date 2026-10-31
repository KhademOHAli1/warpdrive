"use client";
import { Building2, ExternalLink, Link2, SquareKanban, Users } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Tip } from "@/components/ui/tooltip";
import { ACTIVITY_PRIORITY_KEYS } from "@/constants/activityPriorities";
import type { ActivityDraft } from "@/features/deal-workspace/composer/composerHelpers";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { EditableActivity } from "./getForEdit";
import { useActivitiesMessages } from "./useActivitiesMessages";

export function CalendarEventCrmDetails({
  draft,
  types,
  editing,
  onChange,
}: {
  draft: ActivityDraft;
  types: { id: string; name: string }[];
  editing?: EditableActivity;
  onChange: (patch: Partial<ActivityDraft>) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const S = useActivitiesMessages();
  const records = [
    { id: editing?.dealId, name: editing?.dealTitle, prefix: "/deals/", icon: SquareKanban },
    { id: editing?.personId, name: editing?.personName, prefix: "/contacts/people/", icon: Users },
    { id: editing?.orgId, name: editing?.orgName, prefix: "/contacts/orgs/", icon: Building2 },
  ];
  const visible = records.filter((record) => record.id != null && record.name != null);
  const unknownType = draft.typeId !== "" && !types.some((type) => type.id === draft.typeId);
  return (
    <aside
      aria-label={t("editor.activityDetails")}
      className="space-y-6 border-t border-border/70 bg-muted/25 px-6 py-6 md:border-s md:border-t-0"
    >
      <h3 className="text-sm font-semibold">{t("editor.activityDetails")}</h3>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{S.activityType}</p>
        <Select
          ariaLabel={S.activityType}
          value={draft.typeId}
          onChange={(typeId) => onChange({ typeId })}
          options={[
            ...types.map((type) => ({ value: type.id, label: type.name })),
            ...(unknownType ? [{ value: draft.typeId, label: t("editor.currentType") }] : []),
          ]}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{S.priority}</p>
        <Select
          ariaLabel={S.priority}
          value={draft.priority}
          onChange={(priority) => onChange({ priority })}
          options={[
            { value: "", label: S.noPriority },
            ...ACTIVITY_PRIORITY_KEYS.map((key) => ({ value: key, label: S.priorities[key] })),
          ]}
        />
      </div>
      <section
        aria-label={t("editor.linkedRecords")}
        className="space-y-3 border-t border-border/70 pt-5"
      >
        <h4 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Link2 className="size-3.5" aria-hidden />
          {t("editor.linkedRecords")}
        </h4>
        {visible.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              records.some((record) => record.id != null)
                ? "editor.unavailableRecords"
                : "editor.noLinkedRecords",
            )}
          </p>
        ) : (
          visible.map((record) => (
            <Tip key={record.prefix} label={t("editor.openInNewTab")}>
              <a
                href={`${record.prefix}${record.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <record.icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <bdi dir="auto" className="min-w-0 flex-1 truncate">
                  {record.name}
                </bdi>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            </Tip>
          ))
        )}
        {draft.participants.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("editor.contactParticipants", { count: draft.participants.length })}
          </p>
        )}
        {(editing?.participantUserIds.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("editor.teamParticipants", { count: editing?.participantUserIds.length ?? 0 })}
          </p>
        )}
      </section>
    </aside>
  );
}
