"use client";
import type React from "react";
import { TimePicker } from "@/components/ui/TimePicker";
import { ActivityDatePicker } from "@/features/activities/ActivityDatePicker";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface Props {
  startDate: string;
  onStartDate: (v: string) => void;
  startTime: string;
  onStartTime: (v: string) => void;
  endTime: string;
  onEndTime: (v: string) => void;
  // Multi-day end date (Pipedrive parity). Empty string means a same-day activity.
  endDate: string;
  onEndDate: (v: string) => void;
  assigneeId: string;
}

// Compact, single-row date/time controls (Pipedrive parity, C2): start date + time, an end
// time, and an optional end date for multi-day activities. Replaces the composer's stacked
// labeled blocks. Kept as its own component to hold ActivityComposerInline under the file cap.
export function DateRangeRow({
  startDate,
  onStartDate,
  startTime,
  onStartTime,
  endTime,
  onEndTime,
  endDate,
  onEndDate,
  assigneeId,
}: Props): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const loadFor = assigneeId === "" ? null : assigneeId;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActivityDatePicker
        ariaLabel={translateSales("start_date_81696")}
        value={startDate === "" ? null : startDate}
        onChange={(v) => onStartDate(v ?? "")}
        assigneeId={loadFor}
      />
      <TimePicker
        ariaLabel={translateSales("start_time_babe9")}
        value={startTime}
        onChange={onStartTime}
      />
      <span aria-hidden="true" className="text-muted-foreground">
        {translateSales("to_663ea")}
      </span>
      <TimePicker
        ariaLabel={translateSales("end_time_2e460")}
        value={endTime}
        onChange={onEndTime}
      />
      <ActivityDatePicker
        ariaLabel={translateSales("end_date_14303")}
        placeholder={translateSales("end_date_14303")}
        value={endDate === "" ? null : endDate}
        onChange={(v) => onEndDate(v ?? "")}
        assigneeId={loadFor}
      />
    </div>
  );
}
