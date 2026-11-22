"use client";

import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import {
  addCivilDays,
  instantCivilDate,
  instantParts,
  wallTimeToInstant,
} from "@/lib/zonedDateTime";
import type { BookingWindow } from "../contracts";
import type { BookingWords } from "./messages";

type Point = { date: string; time: string };
export type WindowDraft = { start: Point; end: Point };

export function windowDraft(window: BookingWindow | undefined, timeZone: string): WindowDraft {
  if (window !== undefined) {
    return {
      start: instantParts(window.startAt, timeZone),
      end: instantParts(window.endAt, timeZone),
    };
  }
  const day = addCivilDays(instantCivilDate(new Date(), timeZone), 1);
  return { start: { date: day, time: "09:00" }, end: { date: day, time: "11:00" } };
}

function resolvePoint(point: Point, timeZone: string, original: string | undefined) {
  if (point.date === "" || point.time === "") return null;
  if (original !== undefined) {
    const untouched = instantParts(original, timeZone);
    if (untouched.date === point.date && untouched.time === point.time) {
      return { iso: original, ambiguous: false };
    }
  }
  return wallTimeToInstant(point.date, point.time, timeZone);
}

export function resolveBookingWindow(
  draft: WindowDraft,
  timeZone: string,
  old?: BookingWindow,
): { window: BookingWindow; ambiguous: boolean } | null {
  try {
    const start = resolvePoint(draft.start, timeZone, old?.startAt);
    const end = resolvePoint(draft.end, timeZone, old?.endAt);
    if (start === null || end === null || start.iso >= end.iso) return null;
    return {
      window: { startAt: start.iso, endAt: end.iso },
      ambiguous: start.ambiguous || end.ambiguous,
    };
  } catch {
    return null;
  }
}

function PointEditor({
  title,
  dateLabel,
  timeLabel,
  point,
  onChange,
}: {
  title: string;
  dateLabel: string;
  timeLabel: string;
  point: Point;
  onChange: (point: Point) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-wrap items-start gap-2">
        <DatePicker
          value={point.date || null}
          ariaLabel={dateLabel}
          onChange={(date) => onChange({ ...point, date: date ?? "" })}
        />
        <TimePicker
          value={point.time}
          ariaLabel={timeLabel}
          required
          onChange={(time) => onChange({ ...point, time })}
        />
      </div>
    </div>
  );
}

export function BookingTimeFields({
  value,
  pending,
  timeZone,
  valid,
  ambiguous,
  maintenance = false,
  words: t,
  onChange,
}: {
  value: WindowDraft;
  pending: boolean;
  timeZone: string;
  valid: boolean;
  ambiguous: boolean;
  maintenance?: boolean;
  words: BookingWords;
  onChange: (draft: WindowDraft) => void;
}) {
  return (
    <fieldset disabled={pending} className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-xs font-medium">
        {t.zone} <bdi>{timeZone}</bdi>
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <PointEditor
          title={maintenance ? t.starts : t.pickup}
          dateLabel={maintenance ? t.startDate : t.pickupDate}
          timeLabel={maintenance ? t.startTime : t.pickupTime}
          point={value.start}
          onChange={(start) => onChange({ ...value, start })}
        />
        <PointEditor
          title={maintenance ? t.ends : t.returns}
          dateLabel={maintenance ? t.endDate : t.returnDate}
          timeLabel={maintenance ? t.endTime : t.returnTime}
          point={value.end}
          onChange={(end) => onChange({ ...value, end })}
        />
      </div>
      {!valid && <p className="text-xs text-destructive">{t.invalidTime}</p>}
      {ambiguous && <p className="text-xs text-muted-foreground">{t.ambiguousTime}</p>}
    </fieldset>
  );
}
