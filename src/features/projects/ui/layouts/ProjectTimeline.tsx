"use client";

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane v1.5.0 apps/web/components/issues/issue-layouts/gantt/blocks.tsx.
 */

import { ChevronLeft, ChevronRight, GripHorizontal } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useDirection } from "@/components/ui/direction";
import { Select } from "@/components/ui/Select";
import {
  addCalendarMonths,
  formatCalendarDate,
  startOfCalendarMonth,
  startOfCalendarWeek,
} from "@/features/activities/calendarSystem";
import { addDaysUtc } from "@/features/activities/monthGrid";
import { useLocalNow } from "@/features/activities/useLocalNow";
import { localDayIso } from "@/features/activities/weekAgenda";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { type ProjectItem, projectItemKey } from "../../contracts";
import type { WorkItemsProps } from "../ProjectWorkItems";
import {
  calendarDate,
  dateKey,
  differenceInDays,
  itemSchedule,
  translateSchedule,
} from "./projectSchedule";

const zooms = ["week", "month", "quarter"] as const;
type Zoom = (typeof zooms)[number];
type Adjustment = "move" | "start" | "end";

function stepMonths(
  date: Date,
  amount: 1 | 3,
  direction: -1 | 1,
  options: Parameters<typeof addCalendarMonths>[2],
) {
  let next = date;
  for (let i = 0; i < amount; i++) next = addCalendarMonths(next, direction, options);
  return next;
}

function adjust(item: ProjectItem, mode: Adjustment, days: number) {
  if (days === 0) return null;
  if (mode === "move") return translateSchedule(item, days);
  const range = itemSchedule(item);
  if (range === null) return null;
  const span = differenceInDays(range.start, range.end);
  if (mode === "start") {
    const start = addDaysUtc(calendarDate(range.start), Math.min(days, span));
    return { startDate: dateKey(start), dueDate: range.end };
  }
  const end = addDaysUtc(calendarDate(range.end), Math.max(days, -span));
  return { startDate: range.start, dueDate: dateKey(end) };
}

function TimelineBar({
  item,
  from,
  to,
  width,
  pixelPerDay,
  editable,
  labels,
  openItem,
  updateItem,
  rtl,
}: Pick<WorkItemsProps, "openItem" | "updateItem" | "labels"> & {
  item: ProjectItem;
  from: string;
  to: string;
  pixelPerDay: number;
  width: number;
  editable: boolean;
  rtl: boolean;
}) {
  const [preview, setPreview] = useState<{ mode: Adjustment; days: number } | null>(null);
  const drag = useRef<{ mode: Adjustment; x: number } | null>(null);
  const proposed = preview === null ? null : adjust(item, preview.mode, preview.days);
  const saved = itemSchedule(item);
  if (saved === null || saved.start > to || saved.end < from) return null;
  const range = proposed === null ? saved : (itemSchedule(proposed) ?? saved);
  const lastDay = width / pixelPerDay - 1;
  const visibleIndex = (day: string) => Math.min(lastDay, Math.max(0, differenceInDays(from, day)));
  const start = visibleIndex(range.start);
  const end = visibleIndex(range.end);

  function shift(mode: Adjustment, days: number) {
    const changes = adjust(item, mode, days);
    if (changes !== null) void updateItem(item, changes);
  }

  function offset(pointer: number, starting: number) {
    return Math.round((pointer - starting) / pixelPerDay) * (rtl ? -1 : 1);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, mode: Adjustment) {
    if (!editable || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, x: event.clientX };
  }

  function previewDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (current !== null)
      setPreview({ mode: current.mode, days: offset(event.clientX, current.x) });
  }

  function releaseDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    if (current !== null) shift(current.mode, offset(event.clientX, current.x));
  }

  function cancelDrag() {
    drag.current = null;
    setPreview(null);
  }

  function moveWithKeys(event: KeyboardEvent<HTMLButtonElement>, mode: Adjustment) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    shift(mode, (event.key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1));
  }

  const styles = {
    insetInlineStart: start * pixelPerDay + 2,
    width: Math.max(12, (end - start + 1) * pixelPerDay - 4),
  };
  const handle = (mode: Adjustment, label: string) => (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "shrink-0 touch-none rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
        mode === "move"
          ? "cursor-grab px-0.5 text-primary"
          : "w-2 cursor-ew-resize border-current/40",
        mode === "start" && "border-e",
        mode === "end" && "border-s",
      )}
      onPointerDown={(event) => startDrag(event, mode)}
      onPointerMove={previewDrag}
      onPointerUp={releaseDrag}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
      onKeyDown={(event) => moveWithKeys(event, mode)}
    >
      {mode === "move" && <GripHorizontal aria-hidden="true" className="size-3" />}
    </button>
  );

  return (
    <div
      style={styles}
      className="absolute top-2 flex h-7 items-stretch rounded border border-primary/25 bg-primary/15 text-primary"
    >
      {editable &&
        saved.start >= from &&
        handle("start", labels("layout.adjustStart", { title: item.title }))}
      <button
        type="button"
        className="min-w-0 flex-1 truncate px-1 text-start text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => openItem(item.id, event.currentTarget)}
      >
        <bdi>{item.title}</bdi>
      </button>
      {editable &&
        (preview !== null || end - start >= 1) &&
        handle("move", labels("layout.moveSchedule", { title: item.title }))}
      {editable &&
        saved.end <= to &&
        handle("end", labels("layout.adjustEnd", { title: item.title }))}
    </div>
  );
}

export function ProjectTimeline({
  workspace,
  labels,
  openItem,
  pending,
  display,
  updateItem,
}: WorkItemsProps) {
  const options = useLocalePreferences();
  const rtl = useDirection() === "rtl";
  const now = useLocalNow();
  const today = now === null ? null : localDayIso(now, options.timeZone);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("month");
  const date = selected ?? today;
  if (date === null) return null;
  const anchor = calendarDate(date);
  const first =
    zoom === "week" ? startOfCalendarWeek(anchor, options) : startOfCalendarMonth(anchor, options);
  const last =
    zoom === "week"
      ? addDaysUtc(first, 6)
      : addDaysUtc(stepMonths(first, zoom === "quarter" ? 3 : 1, 1, options), -1);
  const from = dateKey(first);
  const to = dateKey(last);
  const count = differenceInDays(from, to) + 1;
  const pixelPerDay = zoom === "quarter" ? 21 : zoom === "week" ? 100 : 38;
  const width = count * pixelPerDay;
  const days = Array.from({ length: count }, (_, i) => addDaysUtc(first, i));
  const separator = "border-e border-border/70";
  function navigate(direction: -1 | 1) {
    setSelected(
      dateKey(
        zoom === "week"
          ? addDaysUtc(first, 7 * direction)
          : stepMonths(first, zoom === "quarter" ? 3 : 1, direction, options),
      ),
    );
  }

  return (
    <section aria-label={labels("layout.timeline")} className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={labels("layout.previousPeriod")}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Button>
          <h2 className="text-sm font-semibold" aria-live="polite">
            {formatCalendarDate(first, options, { month: "short", day: "numeric" })}
            {" – "}
            {formatCalendarDate(last, options, { month: "short", day: "numeric", year: "numeric" })}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label={labels("layout.nextPeriod")}
            onClick={() => navigate(1)}
          >
            <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(null)}>
            {labels("layout.today")}
          </Button>
        </div>
        <Select
          ariaLabel={labels("layout.period")}
          value={zoom}
          options={zooms.map((value) => ({ value, label: labels(`layout.${value}`) }))}
          onChange={(value) => {
            const option = zooms.find((candidate) => candidate === value);
            if (option !== undefined) setZoom(option);
          }}
          triggerClassName="w-auto min-w-28"
        />
      </div>
      <div className="overflow-x-auto">
        <div className="w-max min-w-full text-sm">
          <div className="flex border-b bg-muted/30">
            <div
              className={cn(
                "sticky start-0 z-10 w-56 shrink-0 bg-card px-3 py-2 font-medium",
                separator,
              )}
            >
              {labels("workspace.titleColumn")}
            </div>
            <div className="flex" style={{ width }}>
              {days.map((day) => {
                const iso = dateKey(day);
                return (
                  <time
                    key={iso}
                    dateTime={iso}
                    aria-current={iso === today ? "date" : undefined}
                    className={cn(
                      "shrink-0 py-2 text-center text-xs",
                      separator,
                      iso === today && "bg-primary/15 font-medium text-primary",
                    )}
                    style={{ width: pixelPerDay }}
                  >
                    {formatCalendarDate(day, options, { day: "numeric" })}
                  </time>
                );
              })}
            </div>
          </div>
          {workspace.items.map((item) => (
            <div key={item.id} className="flex border-b last:border-b-0">
              <div
                className={cn(
                  "sticky start-0 z-10 flex w-56 shrink-0 items-center bg-card px-3",
                  separator,
                )}
              >
                {display?.showKey !== false && (
                  <bdi dir="ltr" className="me-2 shrink-0 text-xs text-muted-foreground">
                    {projectItemKey(workspace.project.identifier, item.sequenceNumber)}
                  </bdi>
                )}
                <button
                  type="button"
                  className="min-w-0 truncate py-2.5 text-start font-medium hover:text-primary"
                  onClick={(event) => openItem(item.id, event.currentTarget)}
                >
                  <bdi>{item.title}</bdi>
                  {itemSchedule(item) === null && (
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {labels("layout.unscheduled")}
                    </span>
                  )}
                </button>
              </div>
              <div className="relative min-h-11 shrink-0" style={{ width }}>
                <div aria-hidden="true" className="absolute inset-0 flex">
                  {days.map((day) => (
                    <span
                      key={dateKey(day)}
                      className={cn(separator, dateKey(day) === today && "bg-primary/5")}
                      style={{ width: pixelPerDay }}
                    />
                  ))}
                </div>
                <TimelineBar
                  item={item}
                  from={from}
                  to={to}
                  width={width}
                  pixelPerDay={pixelPerDay}
                  editable={workspace.canEdit && !pending}
                  rtl={rtl}
                  labels={labels}
                  openItem={openItem}
                  updateItem={updateItem}
                />
              </div>
            </div>
          ))}
          {workspace.items.length === 0 && (
            <p className="bg-card p-4 text-sm text-muted-foreground">{labels("workspace.empty")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
