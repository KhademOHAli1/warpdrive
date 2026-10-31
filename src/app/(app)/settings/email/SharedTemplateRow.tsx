import type { SettingsTemplate } from "@/features/email/emailAuthoringReads";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { formatCreatedOn } from "./formatDate";

export function SharedTemplateRow({ template }: { template: SettingsTemplate }) {
  const S = useSettingsMessages()._email;
  const preferences = useLocalePreferences();
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="size-7" />
      <span className="h-4 w-4" />
      <span className="flex flex-1 items-center gap-2">
        {template.name}
        {template.isShared && (
          <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
            {S.sharedBadge}
          </span>
        )}
      </span>
      <span className="w-28 text-xs text-muted-foreground">
        {formatCreatedOn(template.createdAt, preferences)}
      </span>
      <span className="w-24 text-xs text-muted-foreground">{template.ownerName}</span>
    </li>
  );
}
