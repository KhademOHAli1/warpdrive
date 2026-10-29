"use client";
import type React from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import {
  type ActivityDatePreset,
  activePreset,
  type PresetRange,
  presetRange,
} from "./activityDatePresets";
import { useActivitiesMessages } from "./useActivitiesMessages";

// Quick time-preset chips for the activities list (A1). Each sets the filter's date range;
// the chip matching the current range is highlighted. `now` is injectable for testing.
export function ActivityPresetChips({
  from,
  to,
  onApply,
  now,
}: {
  from: string | null;
  to: string | null;
  onApply: (range: PresetRange) => void;
  now?: Date;
}): React.ReactNode {
  const S = useActivitiesMessages();
  const CHIPS: { key: ActivityDatePreset; label: string }[] = [
    { key: "overdue", label: S.overdue },
    { key: "today", label: S.today },
    { key: "this_week", label: S.thisWeek },
    { key: "todo", label: S.todo },
  ];
  const preferences = useLocalePreferences();
  const today = now ?? new Date();
  const active = activePreset(
    { from, to },
    today,
    preferences.calendar,
    preferences.timeZone,
    preferences.locale,
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {CHIPS.map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-pressed={active === chip.key}
          onClick={() =>
            onApply(
              presetRange(
                chip.key,
                today,
                preferences.calendar,
                preferences.timeZone,
                preferences.locale,
              ),
            )
          }
          className={
            active === chip.key
              ? "rounded bg-accent px-3 py-1 text-sm font-medium text-accent-foreground transition-transform active:scale-[0.96]"
              : "rounded px-3 py-1 text-sm text-muted-foreground transition-transform hover:bg-accent/60 active:scale-[0.96]"
          }
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
