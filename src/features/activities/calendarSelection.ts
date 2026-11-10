import { addCivilDays } from "@/lib/zonedDateTime";
import { HOUR_HEIGHT_PX } from "./weekAgenda";

export const SELECTION_STEP_MINUTES = 15;
const MINUTES_PER_DAY = 1440;
export function selectionMinute(clientY: number, top: number): number {
  return Math.max(
    0,
    Math.min(
      MINUTES_PER_DAY - SELECTION_STEP_MINUTES,
      Math.floor((((clientY - top) / HOUR_HEIGHT_PX) * 60) / SELECTION_STEP_MINUTES) *
        SELECTION_STEP_MINUTES,
    ),
  );
}
export function selectionBounds(first: number, last: number): { start: number; end: number } {
  return {
    start: Math.min(first, last),
    end: Math.min(MINUTES_PER_DAY, Math.max(first, last) + SELECTION_STEP_MINUTES),
  };
}
export function minuteClock(minute: number): string {
  const value = minute % MINUTES_PER_DAY;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function calendarSelection(date: string, start: number, end: number) {
  return {
    date,
    time: minuteClock(start),
    endDate: end === MINUTES_PER_DAY ? addCivilDays(date, 1) : date,
    endTime: minuteClock(end),
  };
}
