/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane v1.5.0 apps/web/components/issues/issue-layouts/calendar/utils.ts
 * and the Gantt chart's start_date/target_date range.
 */

import {
  type CalendarOptions,
  startOfCalendarMonth,
  startOfCalendarWeek,
} from "@/features/activities/calendarSystem";
import { addDaysUtc } from "@/features/activities/monthGrid";
import type { ProjectItem } from "../../contracts";

const millisecondsPerDay = 86_400_000;

export const dateKey = (day: Date) => day.toISOString().slice(0, 10);
export const calendarDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function calendarDays(anchor: Date, view: "month" | "week", options: CalendarOptions) {
  const first = startOfCalendarWeek(
    view === "month" ? startOfCalendarMonth(anchor, options) : anchor,
    options,
  );
  return Array.from({ length: view === "month" ? 42 : 7 }, (_, i) => addDaysUtc(first, i));
}

export function calendarDrop(item: ProjectItem, destinationDate: string) {
  if (item.dueDate === destinationDate) return null;
  return { dueDate: destinationDate };
}

export function itemSchedule(item: Pick<ProjectItem, "startDate" | "dueDate">) {
  const start = item.startDate ?? item.dueDate;
  const end = item.dueDate ?? item.startDate;
  if (start === null || end === null) return null;
  return { start, end };
}

export function differenceInDays(first: string, second: string): number {
  return (calendarDate(second).getTime() - calendarDate(first).getTime()) / millisecondsPerDay;
}

export function translateSchedule(
  item: Pick<ProjectItem, "startDate" | "dueDate">,
  offsetDays: number,
) {
  if (offsetDays === 0) return null;
  const shift = (date: string | null) =>
    date === null ? null : dateKey(addDaysUtc(calendarDate(date), offsetDays));
  return { startDate: shift(item.startDate), dueDate: shift(item.dueDate) };
}
