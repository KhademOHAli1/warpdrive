import { CalendarDays } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { useStatsMessages } from "../useStatsMessages";
import { type DatePreset, presetRange } from "./dateRange";

const PRESETS: DatePreset[] = ["last30", "month", "quarter", "year"];

export function DateRangeControl({
  today,
  from,
  to,
  onChange,
}: {
  today: string;
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const S = useStatsMessages();
  const { calendar } = useLocalePreferences();
  const basisId = useId();
  const [selectedPreset, setSelectedPreset] = useState<DatePreset | null>("year");
  const labels = {
    last30: S.last30Days,
    month: S.thisMonth,
    quarter: S.thisQuarter,
    year: S.thisYear,
  };
  const initial = presetRange("year", today, calendar);
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <fieldset
          aria-label={S.datePresets}
          aria-describedby={basisId}
          className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1"
        >
          {PRESETS.map((preset) => {
            const range = presetRange(preset, today, calendar);
            const active = selectedPreset === preset && from === range.from && to === range.to;
            return (
              <Button
                key={preset}
                variant="ghost"
                size="sm"
                aria-pressed={active}
                className={cn(
                  "min-h-10",
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
                onClick={() => {
                  setSelectedPreset(preset);
                  onChange(range);
                }}
              >
                {labels[preset]}
              </Button>
            );
          })}
        </fieldset>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
          <DatePicker
            ariaLabel={S.rangeStartLabel}
            value={from}
            onChange={(v) => {
              setSelectedPreset(null);
              onChange({ from: v ?? initial.from, to });
            }}
          />
          <span className="text-xs text-muted-foreground">{S.rangeSeparator}</span>
          <DatePicker
            ariaLabel={S.rangeEndLabel}
            value={to}
            onChange={(v) => {
              setSelectedPreset(null);
              onChange({ from, to: v ?? initial.to });
            }}
          />
        </div>
      </div>
      <p id={basisId} className="text-pretty text-xs leading-relaxed text-muted-foreground">
        {calendar === "persian" ? S.presetCalendarPersian : S.presetCalendarGregorian}
      </p>
    </div>
  );
}
