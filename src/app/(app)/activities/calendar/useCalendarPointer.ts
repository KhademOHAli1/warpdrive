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
import {
  type CalendarResizeEdge,
  type CalendarResizeTarget,
  calendarResizeTarget,
  snapCalendarResizeMinute,
} from "@/features/activities/calendarResize";
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
  touch: boolean;
  resizeEdge: CalendarResizeEdge | null;
  x: number;
  y: number;
  active: boolean;
  scopeKey: string;
  origin: CalendarPoint;
  activity: CalendarActivity | null;
  capture: HTMLElement;
  chip: HTMLElement | null;
  scroll: HTMLElement | null;
}

const INTERACTIVE =
  "a,button,input,select,textarea,[role=button],[role=combobox],[contenteditable=true]";
const TOUCH_HOLD_MS = 420;
const DRAG_SLOP_PX = 5;

function calendarPoint(element: Element | null, y: number, resize = false): CalendarPoint | null {
  const surface = element?.closest<HTMLElement>("[data-calendar-surface]");
  const date = surface?.dataset.calendarDate;
  if (surface === undefined || surface === null || date === undefined) return null;
  if (surface.dataset.calendarSurface === "date") return { date, minute: 0, kind: "date" };
  const rect = surface.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const snap = resize ? snapCalendarResizeMinute : snapCalendarMinute;
  return { date, minute: snap(y - rect.top, rect.height), kind: "time" };
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

function scrollStep(host: HTMLElement, y: number): number {
  const rect =
    host === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight }
      : host.getBoundingClientRect();
  const pinned = host.querySelector<HTMLElement>(".sticky")?.getBoundingClientRect().height ?? 0;
  return y < rect.top + pinned + 32 ? -12 : y > rect.bottom - 32 ? 12 : 0;
}

function pointAtPosition(
  root: HTMLElement | null,
  x: number,
  y: number,
  resize: boolean,
): CalendarPoint | null {
  const hit = document.elementFromPoint(x, y);
  return hit !== null && root?.contains(hit) === true ? calendarPoint(hit, y, resize) : null;
}

function activateGesture(current: Gesture): void {
  current.active = true;
  current.chip?.setAttribute("data-calendar-dragging", "true");
}

function resizeEdgeOf(target: Element, enabled: boolean): CalendarResizeEdge | null {
  if (!enabled) return null;
  const edge = target.closest<HTMLElement>("[data-calendar-resize-edge]")?.dataset
    .calendarResizeEdge;
  return edge === "start" || edge === "end" ? edge : null;
}

function gestureFromPointer(
  event: React.PointerEvent<HTMLElement>,
  activities: CalendarActivity[],
  scopeKey: string,
  canResize: boolean,
): Gesture | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const touch = event.pointerType === "touch";
  const resizeEdge = resizeEdgeOf(target, !touch && canResize);
  const surface = target.closest<HTMLElement>("[data-calendar-surface]");
  const origin = calendarPoint(target, event.clientY, resizeEdge !== null);
  if (surface === null || origin === null || !event.currentTarget.contains(surface)) return null;
  const chip = target.closest<HTMLElement>("[data-calendar-event-id]");
  const activity =
    chip === null ? null : (activities.find((a) => a.id === chip.dataset.calendarEventId) ?? null);
  if ((chip !== null || touch) && activity === null) return null;
  if (
    chip === null &&
    target.closest(INTERACTIVE) !== null &&
    target.closest("[data-hour]") === null
  )
    return null;
  return {
    id: event.pointerId,
    touch,
    resizeEdge,
    x: event.clientX,
    y: event.clientY,
    active: false,
    scopeKey,
    origin,
    activity,
    capture: target.closest<HTMLElement>("a,button") ?? chip ?? surface,
    chip,
    scroll: scrollHost(surface),
  };
}

function selectionForPoint(
  current: Gesture,
  point: CalendarPoint,
  timeZone: string,
): CalendarSelection | null {
  if (current.activity === null) return calendarSelection(current.origin, point);
  if (current.resizeEdge !== null) {
    return (
      calendarResizeTarget(current.activity, current.resizeEdge, current.origin, point, timeZone)
        ?.selection ?? null
    );
  }
  const target = calendarMoveTarget(current.activity, current.origin, point, timeZone);
  return target === null ? null : movePreviewSelection(current.activity, target, timeZone);
}

export function useCalendarPointer({
  scopeKey,
  activities,
  timeZone,
  disabled,
  onCreate,
  onMove,
  onResize,
  onInvalidMove,
}: {
  scopeKey: string;
  activities: CalendarActivity[];
  timeZone: string;
  disabled: boolean;
  onCreate: (selection: CalendarSelection) => void;
  onMove: (activity: CalendarActivity, target: CalendarMoveTarget) => void;
  onResize?: (
    activity: CalendarActivity,
    target: CalendarResizeTarget,
    selection: CalendarSelection,
  ) => void;
  onInvalidMove?: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const cancelHold = useRef<(() => void) | null>(null);
  const frame = useRef<number | null>(null);
  const position = useRef({ x: 0, y: 0 });
  const [preview, setPreview] = useState<CalendarPointerPreview | null>(null);

  const stop = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    cancelHold.current?.();
    cancelHold.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (current !== null) {
      if (current.active) suppressClick.current = true;
      current.chip?.removeAttribute("data-calendar-dragging");
      if (current.capture.hasPointerCapture(current.id))
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

  useEffect(() => {
    const calendar = root.current;
    if (calendar === null) return;
    const doc = calendar.ownerDocument;
    const extraTouch = (event: TouchEvent): void => {
      if (gesture.current?.touch === true && event.touches.length > 1) stop();
    };
    const touchMove = (event: TouchEvent): void => {
      const current = gesture.current;
      if (current?.touch !== true) return;
      if (
        !current.active ||
        event.touches.length !== 1 ||
        !event.cancelable ||
        isOverlayOpen(doc)
      ) {
        stop();
        return;
      }
      event.preventDefault();
    };
    // Keep native panning available before the hold. A change to touch-action mid-gesture
    // cannot claim the scroll, so cancel the first native touchmove only once the hold wins.
    calendar.addEventListener("touchmove", touchMove, { capture: true, passive: false });
    doc.addEventListener("touchstart", extraTouch, { capture: true, passive: true });
    return () => {
      calendar.removeEventListener("touchmove", touchMove, true);
      doc.removeEventListener("touchstart", extraTouch, true);
    };
  }, [stop]);

  function update(point: CalendarPoint | null): void {
    const current = gesture.current;
    if (current === null || !current.active) return;
    const selection = point === null ? null : selectionForPoint(current, point, timeZone);
    setPreview(
      selection === null || point === null
        ? null
        : {
            selection,
            subject: current.activity?.subject,
            boxes: calendarPreviewBoxes(selection, root.current, point.kind),
          },
    );
  }

  function autoScroll(): void {
    const current = gesture.current;
    if (current === null || !current.active) return;
    const host = current.scroll;
    if (host !== null) {
      const y = position.current.y;
      const step = scrollStep(host, y);
      const before = host.scrollTop;
      if (step !== 0) host.scrollTop += step;
      if (host.scrollTop !== before) {
        update(pointAtPosition(root.current, position.current.x, y, current.resizeEdge !== null));
      }
    }
    frame.current = requestAnimationFrame(autoScroll);
  }

  function holdTouch(current: Gesture): void {
    const doc = current.capture.ownerDocument;
    const overlay = new MutationObserver(() => {
      if (isOverlayOpen(doc)) stop();
    });
    overlay.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "data-radix-popper-content-wrapper"],
    });
    const timer = window.setTimeout(() => {
      if (gesture.current !== current) return;
      if (root.current?.contains(current.capture) !== true || isOverlayOpen(doc)) {
        stop();
        return;
      }
      overlay.disconnect();
      cancelHold.current = null;
      activateGesture(current);
      update(current.origin);
    }, TOUCH_HOLD_MS);
    cancelHold.current = () => {
      window.clearTimeout(timer);
      overlay.disconnect();
    };
  }

  function onPointerDownCapture(event: React.PointerEvent<HTMLElement>): void {
    const ongoing = gesture.current;
    if (ongoing !== null) {
      if (ongoing.touch && event.pointerType === "touch" && ongoing.id !== event.pointerId) stop();
      return;
    }
    if (event.button !== 0 || event.isPrimary === false) return;
    suppressClick.current = false;
    if (disabled || isOverlayOpen(document)) return;
    const current = gestureFromPointer(event, activities, scopeKey, onResize !== undefined);
    if (current === null) return;
    gesture.current = current;
    position.current = { x: event.clientX, y: event.clientY };
    current.capture.setPointerCapture(event.pointerId);
    if (current.touch) holdTouch(current);
  }

  function onPointerMoveCapture(event: React.PointerEvent<HTMLElement>): void {
    const current = gesture.current;
    if (current === null || current.id !== event.pointerId) return;
    if (disabled || isOverlayOpen(document)) {
      stop();
      return;
    }
    position.current = { x: event.clientX, y: event.clientY };
    if (!current.active) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_SLOP_PX) return;
      if (current.touch) {
        stop();
        return;
      }
      activateGesture(current);
    }
    if (frame.current === null) frame.current = requestAnimationFrame(autoScroll);
    event.preventDefault();
    update(
      pointAtPosition(root.current, event.clientX, event.clientY, current.resizeEdge !== null),
    );
  }

  function commitGesture({ activity, origin, resizeEdge }: Gesture, point: CalendarPoint): void {
    if (activity === null) {
      const selection = calendarSelection(origin, point);
      if (selection !== null) onCreate(selection);
      return;
    }
    if (resizeEdge !== null) {
      const resize = calendarResizeTarget(activity, resizeEdge, origin, point, timeZone);
      if (resize === null) onInvalidMove?.();
      else if (resize.changed) onResize?.(activity, resize.target, resize.selection);
      return;
    }
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

  function onPointerUpCapture(event: React.PointerEvent<HTMLElement>): void {
    const current = gesture.current;
    if (current === null || current.id !== event.pointerId) return;
    stop();
    if (disabled || !current.active || isOverlayOpen(document)) return;
    const point = pointAtPosition(
      root.current,
      event.clientX,
      event.clientY,
      current.resizeEdge !== null,
    );
    if (point === null) return;
    event.preventDefault();
    commitGesture(current, point);
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
      onContextMenuCapture: (event: React.MouseEvent<HTMLElement>) => {
        const current = gesture.current;
        if (
          current?.touch === true &&
          event.target instanceof Node &&
          current.chip?.contains(event.target) === true
        ) {
          event.preventDefault();
        }
      },
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
