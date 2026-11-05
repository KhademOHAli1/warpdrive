"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { activityDay } from "@/features/activities/activityTemporal";
import type { CalendarActivity } from "@/features/activities/calendar";
import {
  type CalendarMoveTarget,
  type CalendarPoint,
  type CalendarSelection,
  calendarMoveTarget,
  calendarSelection,
  movePreviewSelection,
  snapCalendarMinute,
} from "@/features/activities/calendarGesture";
import { isOverlayOpen } from "@/features/shortcuts/shortcutTarget";
import { instantParts } from "@/lib/zonedDateTime";
import { type CalendarPreviewBox, calendarPreviewBoxes } from "./calendarPointerGeometry";

export interface CalendarPointerPreview {
  selection: CalendarSelection;
  subject?: string;
  boxes: CalendarPreviewBox[];
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  active: boolean;
  scopeKey: string;
  origin: CalendarPoint;
  point: CalendarPoint | null;
  activity: CalendarActivity | null;
  capture: HTMLElement;
  chip: HTMLElement | null;
  scroll: HTMLElement | null;
}

const INTERACTIVE =
  "a,button,input,select,textarea,[role=button],[role=combobox],[contenteditable=true]";

function calendarPoint(element: Element | null, y: number): CalendarPoint | null {
  const surface = element?.closest<HTMLElement>("[data-calendar-surface]");
  const date = surface?.dataset.calendarDate;
  if (surface === undefined || surface === null || date === undefined) return null;
  if (surface.dataset.calendarSurface === "date") return { date, minute: 0, kind: "date" };
  const rect = surface.getBoundingClientRect();
  if (rect.height <= 0) return null;
  return { date, minute: snapCalendarMinute(y - rect.top, rect.height), kind: "time" };
}

function scrollHost(element: HTMLElement): HTMLElement | null {
  const agenda = element.closest<HTMLElement>("[data-agenda-scroll]");
  if (agenda !== null) return element.dataset.calendarSurface === "date" ? null : agenda;
  let parent = element.parentElement;
  while (parent !== null) {
    if (
      parent.scrollHeight > parent.clientHeight &&
      /auto|scroll/.test(getComputedStyle(parent).overflowY)
    )
      return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

export function useCalendarPointer({
  scopeKey,
  activities,
  timeZone,
  disabled,
  onCreate,
  onMove,
  onInvalidMove,
}: {
  scopeKey: string;
  activities: CalendarActivity[];
  timeZone: string;
  disabled: boolean;
  onCreate: (selection: CalendarSelection) => void;
  onMove: (activity: CalendarActivity, target: CalendarMoveTarget) => void;
  onInvalidMove?: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef<number | null>(null);
  const position = useRef({ x: 0, y: 0 });
  const [preview, setPreview] = useState<CalendarPointerPreview | null>(null);

  const stop = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (current !== null) {
      if (current.active) suppressClick.current = true;
      current.chip?.removeAttribute("data-calendar-dragging");
      if (current.capture.hasPointerCapture?.(current.id))
        current.capture.releasePointerCapture(current.id);
    }
    setPreview(null);
  }, []);

  useEffect(() => {
    if (disabled || (gesture.current !== null && gesture.current.scopeKey !== scopeKey)) stop();
    const key = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || gesture.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", stop);
    window.addEventListener("resize", stop);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", stop);
      window.removeEventListener("resize", stop);
      stop();
    };
  }, [scopeKey, disabled, stop]);

  function update(point: CalendarPoint | null): void {
    const current = gesture.current;
    if (current === null || !current.active) return;
    current.point = point;
    if (point === null) {
      setPreview(null);
      return;
    }
    if (current.activity === null) {
      const selection = calendarSelection(current.origin, point);
      setPreview(
        selection === null
          ? null
          : { selection, boxes: calendarPreviewBoxes(selection, root.current, point.kind) },
      );
      return;
    }
    const target = calendarMoveTarget(current.activity, current.origin, point, timeZone);
    const selection =
      target === null ? null : movePreviewSelection(current.activity, target, timeZone);
    setPreview(
      selection === null
        ? null
        : {
            selection,
            subject: current.activity.subject,
            boxes: calendarPreviewBoxes(selection, root.current, point.kind),
          },
    );
  }

  function autoScroll(): void {
    const current = gesture.current;
    if (current === null || !current.active) return;
    const host = current.scroll;
    if (host !== null) {
      const rect =
        host === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight }
          : host.getBoundingClientRect();
      const pinned =
        host.querySelector<HTMLElement>(".sticky")?.getBoundingClientRect().height ?? 0;
      const y = position.current.y;
      const step = y < rect.top + pinned + 32 ? -12 : y > rect.bottom - 32 ? 12 : 0;
      const before = host.scrollTop;
      if (step !== 0) host.scrollTop += step;
      if (host.scrollTop !== before) {
        const hit = document.elementFromPoint(position.current.x, y);
        update(hit !== null && root.current?.contains(hit) === true ? calendarPoint(hit, y) : null);
      }
    }
    frame.current = requestAnimationFrame(autoScroll);
  }

  function onPointerDownCapture(event: React.PointerEvent<HTMLElement>): void {
    suppressClick.current = false;
    if (
      disabled ||
      event.button !== 0 ||
      event.isPrimary === false ||
      event.pointerType === "touch" ||
      isOverlayOpen(document)
    )
      return;
    if (!(event.target instanceof Element)) return;
    const surface = event.target.closest<HTMLElement>("[data-calendar-surface]");
    const origin = calendarPoint(event.target, event.clientY);
    if (surface === null || origin === null || !event.currentTarget.contains(surface)) return;
    const chip = event.target.closest<HTMLElement>("[data-calendar-event-id]");
    const activity =
      chip === null
        ? null
        : (activities.find((a) => a.id === chip.dataset.calendarEventId) ?? null);
    if (chip !== null && activity === null) return;
    if (
      chip === null &&
      event.target.closest(INTERACTIVE) !== null &&
      event.target.closest("[data-hour]") === null
    )
      return;
    const capture = event.target.closest<HTMLElement>("a,button") ?? chip ?? surface;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      scopeKey,
      origin,
      point: origin,
      activity,
      capture,
      chip,
      scroll: scrollHost(surface),
    };
    position.current = { x: event.clientX, y: event.clientY };
    capture.setPointerCapture?.(event.pointerId);
  }

  function onPointerMoveCapture(event: React.PointerEvent<HTMLElement>): void {
    if (disabled) {
      stop();
      return;
    }
    const current = gesture.current;
    if (current === null || current.id !== event.pointerId) return;
    position.current = { x: event.clientX, y: event.clientY };
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5)
      return;
    if (!current.active) {
      current.active = true;
      current.chip?.setAttribute("data-calendar-dragging", "true");
      frame.current = requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    update(
      hit !== null && root.current?.contains(hit) === true
        ? calendarPoint(hit, event.clientY)
        : null,
    );
  }

  function onPointerUpCapture(event: React.PointerEvent<HTMLElement>): void {
    const current = gesture.current;
    if (current === null || current.id !== event.pointerId) return;
    const { activity, origin, active } = current;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const point =
      hit !== null && root.current?.contains(hit) === true
        ? calendarPoint(hit, event.clientY)
        : null;
    stop();
    if (disabled || !active || point === null) return;
    event.preventDefault();
    if (activity === null) {
      const selection = calendarSelection(origin, point);
      if (selection !== null) onCreate(selection);
    } else {
      const target = calendarMoveTarget(activity, origin, point, timeZone);
      if (target === null) {
        onInvalidMove?.();
        return;
      }
      const start = instantParts(activity.dueAt, timeZone);
      if (
        target.date === activityDay(activity, timeZone) &&
        (target.time === undefined || target.time === start.time)
      )
        return;
      onMove(activity, target);
    }
  }

  function onClickCapture(event: React.MouseEvent<HTMLElement>): void {
    if (suppressClick.current && event.detail !== 0) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      disabled ||
      !(event.target instanceof Element) ||
      event.target.closest(INTERACTIVE) !== null ||
      event.target.closest("[data-calendar-event-id]") !== null
    )
      return;
    const point = calendarPoint(event.target, event.clientY);
    if (point?.kind !== "date") return;
    event.preventDefault();
    onCreate({ date: point.date, endDate: point.date });
  }

  return {
    root,
    preview,
    bindings: {
      onPointerDownCapture,
      onPointerMoveCapture,
      onPointerUpCapture,
      onPointerCancelCapture: (event: React.PointerEvent<HTMLElement>) => {
        if (gesture.current?.id === event.pointerId) stop();
      },
      onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => {
        if (gesture.current?.id === event.pointerId) stop();
      },
      onClickCapture,
      onDragStartCapture: (event: React.DragEvent<HTMLElement>) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-calendar-event-id]") !== null
        )
          event.preventDefault();
      },
    },
  };
}
