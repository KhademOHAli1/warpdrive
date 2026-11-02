"use client";

import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { formatNumber } from "@/lib/localeFormatting";
import { cn } from "@/lib/utils";
import type { PermissionSetRow } from "./types";

export function PermissionSetDirectory({
  sets,
  selectedId,
  pending,
  onSelect,
}: {
  sets: PermissionSetRow[];
  selectedId?: string;
  pending: boolean;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const L = useSettingsMessages();
  const preferences = useLocalePreferences();
  return (
    <ul
      aria-label={L._hierarchy.permissionSetList}
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
    >
      {sets.map((set) => (
        <li key={set.id}>
          <Button
            variant="outline"
            disabled={pending}
            aria-label={set.name}
            aria-pressed={set.id === selectedId}
            aria-describedby={`permission-set-${set.id}-summary`}
            onClick={() => onSelect(set.id)}
            className={cn(
              "h-auto min-h-16 w-full flex-col items-start gap-1 whitespace-normal px-4 py-3 text-start",
              set.id === selectedId && "border-ring bg-accent",
            )}
          >
            <span className="break-words font-semibold">{set.name}</span>
            <span
              id={`permission-set-${set.id}-summary`}
              className="text-xs font-normal text-muted-foreground"
            >
              {formatNumber(Object.values(set.flags).filter(Boolean).length, preferences)}{" "}
              {L.columns.flagsEnabled}
              {set.isDefault === true && (
                <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {L.columns.default}
                </span>
              )}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
