"use client";

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane v1.5.0 apps/web/components/issues/issue-layouts/calendar/calendar.tsx.
 */

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ToggleField } from "@/components/ui/ToggleField";
import {
  addCalendarMonths,
  calendarWeekdayLabels,
  formatCalendarDate,
  isSameCalendarMonth,
} from "@/features/activities/calendarSystem";
import { addDaysUtc } from "@/features/activities/monthGrid";
import { useLocalNow } from "@/features/activities/useLocalNow";
import { localDayIso } from "@/features/activities/weekAgenda";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { type ProjectItem, projectItemKey } from "../../contracts";
import type { WorkItemsProps } from "../ProjectWorkItems";
import { calendarDate, calendarDays, calendarDrop, dateKey } from "./projectSchedule";

function CalendarCard({
  item,
  openItem,
  labels,
  draggable,
  identifier,
}: Pick<WorkItemsProps, "openItem" | "labels"> & {
  item: ProjectItem;
  draggable: boolean;
  identifier?: string;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: item.id, disabled: !draggable });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "flex items-center gap-1 rounded border bg-background px-1.5 text-xs",
        isDragging && "relative z-10 opacity-80 shadow",
      )}
    >
      {draggable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          ref={setActivatorNodeRef}
          tabIndex={-1}
          aria-label={labels("workspace.drag", { title: item.title })}
          className="touch-none cursor-grab text-muted-foreground"
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        className="min-w-0 flex-1 truncate rounded py-1.5 text-start hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={item.title}
        onClick={(event) => openItem(item.id, event.currentTarget)}
      >
        {identifier !== undefined && (
          <bdi dir="ltr" className="me-1 text-muted-foreground">
            {projectItemKey(identifier, item.sequenceNumber)}
          </bdi>
        )}
        <bdi>{item.title}</bdi>
      </button>
    </li>
  );
}

function CalendarCell({
  keyDate,
  dateLabel,
  outsideMonth,
  today,
  cards,
  create,
  openItem,
  labels,
  draggable,
  identifier,
}: Pick<WorkItemsProps, "openItem" | "labels"> & {
  keyDate: string;
  dateLabel: string;
  outsideMonth: boolean;
  today: boolean;
  cards: ProjectItem[];
  create?: ReactNode;
  draggable: boolean;
  identifier?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: keyDate, disabled: !draggable });
  return (
    <td
      ref={setNodeRef}
      className={cn(
        "h-28 min-w-28 border-t border-e p-1.5 align-top last:border-e-0",
        outsideMonth && "bg-muted/35 text-muted-foreground",
        isOver && "bg-primary/10",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <time
          dateTime={keyDate}
          aria-current={today ? "date" : undefined}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full text-xs",
            today && "bg-primary font-medium text-primary-foreground",
          )}
        >
          {dateLabel}
        </time>
        {create}
      </div>
      {cards.length > 0 && (
        <ul className="space-y-1">
          {cards.map((item) => (
            <CalendarCard
              key={item.id}
              item={item}
              labels={labels}
              openItem={openItem}
              draggable={draggable}
              identifier={identifier}
            />
          ))}
        </ul>
      )}
    </td>
  );
}

export function ProjectCalendar({
  workspace,
  labels,
  pending,
  display,
  openItem,
  updateItem,
  createOnDay,
}: WorkItemsProps & { createOnDay?: (date: string) => ReactNode }) {
  const options = useLocalePreferences();
  const now = useLocalNow();
  const today = now === null ? null : localDayIso(now, options.timeZone);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [period, setPeriod] = useState<"month" | "week">("month");
  const [showWeekends, setShowWeekends] = useState(true);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }));
  const selected = selectedDate ?? today;
  if (selected === null) return null;

  const anchor = calendarDate(selected);
  const days = calendarDays(anchor, period, options);
  const headings = calendarWeekdayLabels(options);
  const firstDay = days[0]?.getUTCDay() ?? 1;
  const weekdays = headings.flatMap((label, offset) => {
    const day = (firstDay + offset) % 7;
    const weekend = options.calendar === "persian" ? day === 5 : day === 0 || day === 6;
    return showWeekends || !weekend ? [{ label, offset }] : [];
  });
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const due = new Map<string, ProjectItem[]>();
  for (const item of workspace.items) {
    if (item.dueDate === null) continue;
    const items = due.get(item.dueDate) ?? [];
    items.push(item);
    due.set(item.dueDate, items);
  }
  const draggable = workspace.canEdit && !pending;
  const title = formatCalendarDate(
    anchor,
    options,
    period === "month"
      ? { month: "long", year: "numeric" }
      : { month: "long", day: "numeric", year: "numeric" },
  );

  function move({ active, over }: DragEndEvent) {
    if (!draggable || typeof over?.id !== "string") return;
    const item = workspace.items.find(({ id }) => id === active.id);
    if (item === undefined) return;
    const changes = calendarDrop(item, over.id);
    if (changes !== null) void updateItem(item, changes);
  }

  function navigate(direction: -1 | 1) {
    setSelectedDate(
      dateKey(
        period === "week"
          ? addDaysUtc(anchor, direction * 7)
          : addCalendarMonths(anchor, direction, options),
      ),
    );
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
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
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label={labels("layout.nextPeriod")}
            onClick={() => navigate(1)}
          >
            <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(null)}>
            {labels("layout.today")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            ariaLabel={labels("layout.period")}
            value={period}
            options={[
              { value: "month", label: labels("layout.month") },
              { value: "week", label: labels("layout.week") },
            ]}
            onChange={(value) => setPeriod(value === "week" ? "week" : "month")}
            triggerClassName="w-auto min-w-24"
          />
          <ToggleField
            label={labels("layout.weekends")}
            checked={showWeekends}
            onCheckedChange={setShowWeekends}
          />
        </div>
      </div>
      <DndContext
        id={`project-calendar-${workspace.project.id}`}
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragEnd={move}
      >
        <div className="overflow-x-auto">
          <table
            aria-label={labels("layout.calendar")}
            className="w-full table-fixed text-start"
            style={{ minWidth: weekdays.length * 112 }}
          >
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {weekdays.map(({ label, offset }) => (
                  <th
                    key={offset}
                    scope="col"
                    className="min-w-28 p-2 text-center text-xs font-medium"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]?.toISOString()}>
                  {weekdays.map(({ offset }) => {
                    const day = week[offset];
                    if (day === undefined) return null;
                    const iso = dateKey(day);
                    return (
                      <CalendarCell
                        key={iso}
                        keyDate={iso}
                        today={iso === today}
                        dateLabel={formatCalendarDate(day, options, { day: "numeric" })}
                        outsideMonth={
                          period === "month" && !isSameCalendarMonth(day, anchor, options)
                        }
                        cards={due.get(iso) ?? []}
                        create={createOnDay?.(iso)}
                        openItem={openItem}
                        labels={labels}
                        draggable={draggable}
                        identifier={
                          display?.showKey === true ? workspace.project.identifier : undefined
                        }
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DndContext>
      {workspace.items.some(({ dueDate }) => dueDate === null) && (
        <div className="border-t px-4 py-3">
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">
            {labels("layout.unscheduled")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {workspace.items
              .filter(({ dueDate }) => dueDate === null)
              .map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-sm hover:bg-accent"
                    onClick={(event) => openItem(item.id, event.currentTarget)}
                  >
                    <bdi>{item.title}</bdi>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
